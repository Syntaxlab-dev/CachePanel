# Contributing to CachePanel

Thanks for considering it. CachePanel is a small, self-hosted project — PRs, bug reports, and feature ideas are all welcome, no formal process required.

## Local development

Backend and frontend run separately in dev (they're only combined into one image at build time).

**Backend** (Python 3.12+):

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The backend expects a LanCache setup nearby (log directory, prefill tool containers, Docker socket) to be fully functional — see the README's Setup section for the volume layout. For pure UI work you can run it without those and just expect the dashboard/health calls to come back empty rather than erroring.

**Frontend** (Node 22+):

```bash
cd frontend
npm install
npm run dev
```

Points at the backend on its default port; `npm run build` (which also runs `tsc -b`) must pass before a PR is merged, same as `npm run lint` (`oxlint`).

## Code style

There's no formatter enforced in CI, but the existing code follows a consistent style — please match it rather than introducing a new one:

- No comments explaining *what* code does — names should already make that clear. A comment is only worth adding when it explains a non-obvious *why* (a workaround, a constraint from an external system, a rejected alternative approach). Look at `backend/app/services/discord_notifier.py` or `cover_art.py` for the kind of comment that's welcome vs. not.
- Every backend service that touches something optional (an API key, a webhook URL, a config value) follows the same "blank = feature off, no error" contract — see `LANCACHE_IP` in `health.py`, `steamgriddb_api_key` in `cover_art.py`, `discord_webhook_url` in `discord_notifier.py`. New optional integrations should follow the same shape.
- Don't guess at an external system's behavior (log formats, API responses, CLI flags, third-party protocols) — verify it live against the real thing where possible, the same way this project's existing code was built.

## Translations (DE/EN)

The UI ships German and English (`frontend/src/lib/i18n.tsx`), with the two dictionaries kept in exact key parity — every string goes through `t("key")`, no hardcoded UI text in either language. If your PR adds or changes UI text, add both the `de` and `en` entries in the same change; a PR that only adds one will need the other before merge.

Additional languages beyond DE/EN aren't a current priority for the maintainers, but the `i18n.tsx` structure is a plain object per language — a PR adding a third language dictionary is welcome if the community wants to contribute one.

## Before opening a PR

- Backend: `python -m py_compile` on anything you touched (or better, actually run it against a real LanCache setup if you have one)
- Frontend: `npm run build` and `npm run lint` both clean
- If you touched UI text: both `de` and `en` entries added, no hardcoded strings
- Describe *why* the change is needed, not just what it does — the PR description is the right place for that context, not code comments

## Where to start

Issues labeled [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are a reasonable place to get familiar with the codebase. If nothing's labeled yet, a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) or [feature request](.github/ISSUE_TEMPLATE/feature_request.md) is a good way to start a conversation before writing code — especially for anything touching prefill behavior or the cache itself, where a wrong assumption can be expensive to unwind.
