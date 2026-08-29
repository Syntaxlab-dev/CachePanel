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
    # One-row table: the single username/password_hash pair that guards the
    # panel itself -- same "there's only ever one" contract as auth.json.
    """
    CREATE TABLE IF NOT EXISTS auth (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        CONSTRAINT auth_single_row CHECK (id = 1)
    )
    """,
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
        conn.commit()
