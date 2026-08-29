# CachePanel on TrueNAS SCALE

There is no official CachePanel entry in the TrueNAS Apps catalog. Getting one added there means submitting to iXsystems' own `truenas/charts`/apps-catalog repository and going through their separate review process — that's a bigger, longer-running effort outside this project's own repo, and isn't done here.

What *is* straightforward today: since **TrueNAS SCALE 25.04 ("Fangtooth")**, the Apps screen runs plain Docker Compose directly (no more Kubernetes underneath), so any working `docker-compose.yml` — including this project's own, unmodified — can be deployed as a **Custom App** without needing a catalog entry at all.

## Steps

1. On the TrueNAS SCALE web UI, go to **Apps → Discover Apps → Install via YAML** (sometimes shown as **Custom App**).
2. Give it a name, e.g. `cachepanel`.
3. Paste the contents of this repo's [`docker-compose.yml`](../docker-compose.yml) into the YAML editor.
4. Before deploying, adjust the host-side paths in `volumes:` to match your own pool/dataset layout, for example:
   - `./data` → a dataset such as `/mnt/<pool>/appdata/cachepanel`
   - `/mnt/lancache/logs` → wherever your LanCache access logs actually live
   - the three `*-prefill/config` paths → the **same host paths** your existing `steam-prefill`/`battlenet-prefill`/`epic-prefill` containers already use (CachePanel writes game selections into those files, so it needs to see the same directories those containers read from)
5. Copy [`.env.example`](../.env.example) to a real `.env` next to your compose file (or inline the variables directly into the YAML's `environment:` section) and adjust as needed — most of it can stay commented out, since Steam/SteamGridDB/Discord credentials are entered through the CachePanel web UI itself after first launch, not via environment variables.
6. Deploy. The web UI will be reachable on the host port you mapped (`8090` by default in the shipped compose file).

## Prerequisites

Same as any CachePanel deployment: an existing LanCache setup (`lancache` + `lancache-dns`) and the `tpill90` SteamPrefill/BattleNetPrefill/EpicPrefill containers already running somewhere reachable from the TrueNAS host. CachePanel is a UI/controller for those tools, not a replacement for them.

## Docker socket access

CachePanel needs read access to the Docker socket (`/var/run/docker.sock`) to trigger prefill runs and read container/health status. TrueNAS SCALE's Custom App YAML editor accepts this the same way any other Docker Compose file would — mount it read-only, exactly as in the shipped `docker-compose.yml`.
