"""Optional PostgreSQL-backed storage.

Every store (app_settings_store.py, run_history_store.py, schedule_store.py,
auth_credentials_store.py) keeps its existing JSON-file-under-/data behavior
as the unconditional default -- this module only gets used when DATABASE_URL
is set. Each store owns its own read/write logic either way; this module
just owns the connection and the one-time schema bootstrap, so a store
never has to know whether it's talking to a file or a database beyond a
single `if db.is_enabled():` branch.

cover_art.py's SteamGridDB response cache deliberately stays a plain file
even with DATABASE_URL set -- it's disposable, self-healing cache data (a
lost cache just means the next page load re-fetches from SteamGridDB), not
state a user would be upset to lose, so there's no reason to add DB
round-trips to it.
"""

import psycopg

from app.settings import settings

_SCHEMA_STATEMENTS = [
    # One-row table: the entire encrypted settings blob, same shape as
    # settings.json today, just stored in a column instead of a file.
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        encrypted_blob BYTEA NOT NULL,
        CONSTRAINT app_settings_single_row CHECK (id = 1)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS run_history (
        id SERIAL PRIMARY KEY,
        service TEXT NOT NULL,
        started_at TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        duration_seconds REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS schedule (
        service TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL,
        hour INTEGER NOT NULL,
        minute INTEGER NOT NULL
    )
    """,
    # The username/password_hash pairs that guard the panel itself. One or
    # more rows -- see auth_credentials_store.py for the multi-user contract.
    # role/totp_* are also created here directly so a brand-new deployment
    # gets the current shape immediately; _AUTH_MIGRATION_STATEMENTS below
    # adds the same columns to a table that already existed before this
    # feature round (IF NOT EXISTS makes running both against a fresh
    # table a harmless no-op).
    """
    CREATE TABLE IF NOT EXISTS auth (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        totp_secret TEXT,
        totp_enabled BOOLEAN NOT NULL DEFAULT FALSE
    )
    """,
    # Read-only third-party API tokens (3rd feature round, Welle 2) -- see
    # api_token_store.py. created_date is TEXT (an ISO string written by
    # Python), same convention run_history.started_at already uses here,
    # not a native TIMESTAMPTZ column.
    """
    CREATE TABLE IF NOT EXISTS api_tokens (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        created_date TEXT NOT NULL
    )
    """,
    # Client IP -> human-readable device name (3rd feature round, Welle 3)
    # -- see client_labels_store.py. Plain text, not a secret, so no Fernet
    # blob here unlike app_settings.
    """
    CREATE TABLE IF NOT EXISTS client_labels (
        ip TEXT PRIMARY KEY,
        label TEXT NOT NULL
    )
    """,
    # Daily "records" snapshot (3rd feature round, Welle 4) -- see
    # records_store.py. Single fixed row (id=1), same shape as
    # app_settings' one-row table, not an open-ended key space.
    """
    CREATE TABLE IF NOT EXISTS records (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        most_bandwidth_saved_bytes BIGINT NOT NULL DEFAULT 0,
        most_bandwidth_saved_date TEXT,
        highest_hit_ratio REAL NOT NULL DEFAULT 0,
        highest_hit_ratio_date TEXT,
        CONSTRAINT records_single_row CHECK (id = 1)
    )
    """,
    # Day-by-day traffic history for the long-term trends chart (3rd
    # feature round, Welle 5) -- see daily_stats_store.py. A genuinely
    # growing time series (one row per day), unlike the fixed-shape
    # `records` table above.
    """
    CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        hit_bytes BIGINT NOT NULL DEFAULT 0,
        miss_bytes BIGINT NOT NULL DEFAULT 0,
        total_requests INTEGER NOT NULL DEFAULT 0
    )
    """,
    # Browser Push API subscriptions (3rd feature round, Welle 5) -- see
    # webpush_subscriptions_store.py. subscription_json is the whole
    # PushSubscription.toJSON() blob as one TEXT column (not decomposed
    # into columns) since this store never needs to query into it, only
    # round-trip it back to pywebpush.webpush() unmodified.
    """
    CREATE TABLE IF NOT EXISTS webpush_subscriptions (
        endpoint TEXT PRIMARY KEY,
        subscription_json TEXT NOT NULL
    )
    """,
    # WebAuthn/passkey credentials (4th feature round, Welle 2) -- see
    # webauthn_credential_store.py. credential_id/public_key are stored
    # base64url-encoded TEXT (not BYTEA) purely for consistency with the
    # rest of this table's TEXT-only columns; they're opaque blobs either
    # way, never queried by content. sign_count is the replay-detection
    # counter from the authenticator, updated after every successful login.
    """
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
        credential_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        public_key TEXT NOT NULL,
        sign_count BIGINT NOT NULL DEFAULT 0,
        rp_id TEXT NOT NULL,
        label TEXT NOT NULL,
        created_date TEXT NOT NULL
    )
    """,
    # Server-side session registry overlay (4th feature round, Welle 2) --
    # see session_registry_store.py. Starlette's SessionMiddleware itself
    # stays a stateless signed cookie (see main.py's comment); this table
    # is what makes "view active logins, log out one of them" possible
    # despite that, by letting auth_guard.py reject a cookie whose
    # session_id was deleted here even though the cookie's own signature
    # is still perfectly valid.
    """
    CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        client_ip TEXT NOT NULL,
        user_agent TEXT NOT NULL
    )
    """,
]

# Run unconditionally, after _SCHEMA_STATEMENTS, on every startup -- each
# statement is written to be a no-op if already applied, so this safely
# upgrades an existing single-user `auth` table (id SMALLINT DEFAULT 1,
# CHECK id = 1) left over from before Welle 4 without dropping the one
# account already in production. Deliberately NOT folded into
# _SCHEMA_STATEMENTS: CREATE TABLE IF NOT EXISTS alone can't alter a table
# that already exists in the old shape.
_AUTH_MIGRATION_STATEMENTS = [
    "ALTER TABLE auth DROP CONSTRAINT IF EXISTS auth_single_row",
    "ALTER TABLE auth ALTER COLUMN id DROP DEFAULT",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'auth_username_unique'
        ) THEN
            ALTER TABLE auth ADD CONSTRAINT auth_username_unique UNIQUE (username);
        END IF;
    END $$
    """,
    # role/TOTP columns (3rd feature round) -- ADD COLUMN IF NOT EXISTS is
    # itself idempotent, no DO $$ guard needed. Defaults match
    # auth_credentials_store.py's _normalize(): role="admin" so an existing
    # account never loses privileges, totp_enabled=FALSE so nobody is
    # suddenly asked for a second factor they never set up.
    "ALTER TABLE auth ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'",
    "ALTER TABLE auth ADD COLUMN IF NOT EXISTS totp_secret TEXT",
    "ALTER TABLE auth ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE",
]


def is_enabled() -> bool:
    return bool(settings.database_url)


def get_connection() -> psycopg.Connection:
    return psycopg.connect(settings.database_url)


def init_schema() -> None:
    """Called once at startup (see main.py's lifespan). A no-op unless
    DATABASE_URL is set. Statements are executed one at a time rather than
    as one multi-statement string -- psycopg3's execute() uses the extended
    query protocol, which (unlike psycopg2) doesn't reliably support
    multiple ;-separated statements in a single call."""
    if not is_enabled():
        return
    with get_connection() as conn:
        for statement in _SCHEMA_STATEMENTS:
            conn.execute(statement)
        for statement in _AUTH_MIGRATION_STATEMENTS:
            conn.execute(statement)
        conn.commit()
