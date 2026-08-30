# CachePanel CLI

A small standalone script that talks to CachePanel's existing REST API --
no separate install, no extra dependency. Works with any Python 3 (uses
only the standard library).

## Setup

Download `cachepanel-cli.py`, then set two environment variables (or pass
the equivalent flags every time):

```bash
export CACHEPANEL_URL=http://10.0.0.160:8090
export CACHEPANEL_TOKEN=your-read-only-api-token   # from Settings -> API-Tokens
```

## Read-only commands (use `CACHEPANEL_TOKEN`)

```bash
python3 cachepanel-cli.py status
python3 cachepanel-cli.py history
```

## Commands that change state (need an admin login, not a token)

API tokens are always read-only (see Settings -> API-Tokens), so these
commands log in themselves with a username and password instead. Never
pass a password as a command-line flag -- it would land in your shell
history. Either type it when prompted, or set `CACHEPANEL_PASSWORD` in an
environment you control (e.g. a CI secret, not a shared shell):

```bash
python3 cachepanel-cli.py prefill steam --username admin
python3 cachepanel-cli.py clear-cache --username admin   # asks to confirm, or pass -y
```

Accounts with two-factor authentication enabled aren't supported by these
commands -- use the web UI for those, or a second account without 2FA.

## All options

```
python3 cachepanel-cli.py --help
```
