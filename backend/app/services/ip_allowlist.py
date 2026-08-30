"""IP/CIDR allowlist for the panel's own session-cookie login (4th feature
round, Welle 2) -- see auth_guard.py for where this is enforced and
app_settings_store.py's ip_allowlist field for storage.

Uses the same "trust request.client.host, never X-Forwarded-For" rule as
login_rate_limit.py, for the same reason: this app is meant to sit on a
trusted LAN or behind a reverse proxy the operator controls, and trusting a
client-supplied header without knowing a proxy is actually there would let
anyone bypass the whole allowlist just by sending that header themselves.
"""

import ipaddress


def is_allowed(client_ip: str, allowlist: list[str]) -> bool:
    """Empty allowlist = feature off = everyone allowed (same "empty = off"
    contract as every other optional setting in this project). A malformed
    entry (typo, not a valid IP/CIDR) is skipped rather than raising --
    one bad entry in a list of otherwise-valid ones shouldn't either crash
    the request or, worse, silently degrade to "wildcard forgot to combine
    with a bad entry that would have matched everything"."""
    if not allowlist:
        return True
    try:
        client = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    for entry in allowlist:
        entry = entry.strip()
        if not entry:
            continue
        try:
            network = ipaddress.ip_network(entry, strict=False)
        except ValueError:
            continue
        if client in network:
            return True
    return False
