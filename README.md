# CachePanel

A modern, self-hosted web UI for [LanCache](https://lancache.net/) setups running
the [tpill90 prefill tools](https://github.com/tpill90) (SteamPrefill, BattleNetPrefill,
EpicPrefill).

Those tools are excellent, but selecting which games to pre-cache means running
an interactive terminal checklist (`docker exec -it steam-prefill ... select-apps`)
for each platform separately, and there's no unified view of what's actually
been cached. CachePanel replaces both of those with one dashboard:

- **See what's happening** — cache hit/miss ratio, traffic per service, recent
  download activity, parsed straight from your LanCache logs.
- **Pick what to pre-cache, in a browser** — no more terminal checklists.
  - **Steam**: your real library, pulled from the official Steam Web API.
  - **Battle.net**: the full list of Blizzard/Activision/Microsoft products
    available through Battle.net's Tact CDN.
  - **Epic Games**: manual add-by-name (Epic has no public ownership API —
    see [Known limitations](#known-limitations)).
- **Trigger a download on demand** — no need to wait for the nightly schedule.

![Dashboard screenshot](docs/screenshot-dashboard.png)
<!-- Add real screenshots here once deployed: dashboard, steam, battlenet, epic -->

## Tech stack

- **Backend**: Python, [FastAPI](https://fastapi.tiangolo.com/)
- **Frontend**: React, Vite, TypeScript, Tailwind CSS, shadcn/ui-style components
- Single Docker image — the backend serves the built frontend, one container,
  one port.

## Setup

CachePanel expects to run alongside an existing LanCache + prefill-tools stack
(see [lancache.net](https://lancache.net/) and the tpill90 prefill tools for
the base setup — CachePanel doesn't replace those, it drives them).

1. Copy `.env.example` to `.env` and fill in a free
   [Steam Web API key](https://steamcommunity.com/dev/apikey) and your
   [SteamID64](https://steamid.io/).
2. Adjust the volume paths in `docker-compose.yml` if your prefill tools'
   config directories or LanCache log directory don't live at the defaults
   (`/opt/stacks/<tool>/config`, `/mnt/lancache/logs`).
3. `docker compose up -d --build`
4. Open `http://<host>:8090`.

CachePanel needs read/write access to each prefill tool's config directory
(to manage the `selectedAppsToPrefill.json` selection file) and to the Docker
socket (to trigger an on-demand `prefill` run inside those containers).

## Known limitations

- **Epic Games** has no public API for a personal library, so v1 only
  supports manually adding app names/IDs. Full catalog browsing (via an
  OAuth device-code flow, similar to what the
  [`legendary`](https://github.com/derrod/legendary) project does) is a
  natural follow-up.
- **Battle.net**'s catalog is a curated static list sourced from
  [BattleNetPrefill's own source](https://github.com/tpill90/battlenet-lancache-prefill/blob/master/BattleNetPrefill/TactProduct.cs),
  since Blizzard doesn't expose a per-account ownership API either. Update
  `backend/app/services/battlenet_catalog.py` if new products are added
  upstream.
- No authentication on the panel itself — intended for trusted local
  networks, same as the tools it manages.

## License

MIT — see [LICENSE](LICENSE).
