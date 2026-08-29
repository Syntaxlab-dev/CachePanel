# CachePanel

[![Docker publish](https://github.com/Syntaxlab-dev/CachePanel/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Syntaxlab-dev/CachePanel/actions/workflows/docker-publish.yml)
[![License: MIT](https://img.shields.io/github/license/Syntaxlab-dev/CachePanel)](LICENSE)
[![Image](https://img.shields.io/badge/image-ghcr.io%2Fsyntaxlab--dev%2Fcachepanel-blue)](https://github.com/Syntaxlab-dev/CachePanel/pkgs/container/cachepanel)

> **Provided as-is, no warranty.** CachePanel is licensed under the [MIT License](LICENSE) —
> use it at your own risk, the authors accept no liability for any damages arising from its use.

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
- Dark mode, per-game download sizes (Steam), and a live health check for the
  core LanCache containers.

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

1. Copy `.env.example` to `.env` (no Steam credentials needed here — see step 4).
2. Adjust the volume paths in `docker-compose.yml` if your prefill tools'
   config directories or LanCache log directory don't live at the defaults
   (`/opt/stacks/<tool>/config`, `/mnt/lancache/logs`).
3. Build from source, or use the published image — both work with the same
   `docker-compose.yml`:
   - **From source:** leave `build: .` as-is, `docker compose up -d --build`.
   - **Published image:** every push to `main` publishes
     `ghcr.io/syntaxlab-dev/cachepanel:latest` (see
     [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)).
     Swap the `build: .` line for `image: ghcr.io/syntaxlab-dev/cachepanel:latest`
     and run `docker compose up -d` — no local build needed.
4. Open `http://<host>:8090` and go to **Settings** to enter your own free
   [Steam Web API key](https://steamcommunity.com/dev/apikey) and
   [SteamID64](https://steamid.io/) — stored locally on your server, never
   baked into the image or shared with anyone else who might deploy CachePanel.

CachePanel needs read/write access to each prefill tool's config directory
(to manage the `selectedAppsToPrefill.json` selection file) and to the Docker
socket (to trigger an on-demand `prefill` run inside those containers).

## Monitoring: Prometheus & Grafana

CachePanel exposes a Prometheus-compatible `/metrics` endpoint — deliberately
unauthenticated (it sits outside `/api/`, see `backend/app/routers/metrics.py`
for why) so an external scraper can reach it without a session cookie. It
covers cache hit/miss bytes and requests per service, hit ratio, core-container
health, and the most recent prefill run per service.

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: cachepanel
    static_configs:
      - targets: ["<host>:8090"]
```

A ready-made dashboard ships at
[`grafana/cachepanel-dashboard.json`](grafana/cachepanel-dashboard.json) —
add a Prometheus datasource in Grafana pointed at your scraper, then
**Dashboards → New → Import** and pick that file.

## Discord notifications

Settings → Notifications accepts an optional Discord webhook URL (leave
blank to disable). When set, CachePanel can post to it on a successful or
failed prefill run, and on a cache disk usage warning (checked every 30
minutes, fires once when crossing 90% used and again after dropping back
below and re-crossing). A "Send test" button lets you verify the URL
immediately. A webhook failure or timeout only logs a warning — it never
breaks a prefill run.

## Deploying on Unraid / TrueNAS SCALE

- **Unraid**: [`unraid/cachepanel.xml`](unraid/cachepanel.xml) is a
  Community Applications template, written against this project's own
  `docker-compose.yml`. Not yet submitted to Community Applications — that
  requires a published `ghcr.io` image, which doesn't exist until this
  project's GHCR publishing workflow ships. Usable manually today via
  Docker Compose Manager or by adding it as a custom template in the interim.
- **TrueNAS SCALE** (25.04 "Fangtooth" and later): see
  [`truenas/README.md`](truenas/README.md) — SCALE's Apps screen runs plain
  Docker Compose natively now, so this project's own compose file works
  as a Custom App with a few host-path adjustments. No official catalog
  entry (that's a separate submission process to iXsystems' own repo,
  out of scope here).

## API docs

The backend's interactive API docs are available at `/docs` (Swagger UI) and
`/openapi.json` (machine-readable schema) on any running instance.

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
- The panel has its own login (set up on first launch), independent of
  anything else running alongside it — still meant for a trusted home
  network rather than public exposure, but no longer wide open by default.

## Security notes

Your Steam credentials (and anything else stored via the Settings page) are
encrypted at rest in `data/settings.json`, with the key kept in a separate
file (`data/.encryption_key`). This protects the settings file if it leaks
in isolation (e.g. an accidental backup or copy) — it does **not** protect
against someone who already has root/filesystem access to the host
CachePanel runs on, since the key lives right next to the data it protects.
For a single-container self-hosted tool there's no realistic way to clear
that bar without an external secrets manager, which is out of scope here.

## Contributing

Bug reports, feature ideas, and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for local dev setup, code style, and the DE/EN translation contract. Issues labeled
[`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
are a reasonable place to start.

## License

MIT — see [LICENSE](LICENSE).
