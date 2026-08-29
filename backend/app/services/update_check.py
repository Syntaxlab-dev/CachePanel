"""One-shot, best-effort check of whether the `latest` GHCR image tag is
newer than the commit this instance was built from. Called once when the
Settings page's "About" card loads -- NOT a background poller, and never
surfaces an error to the user: this is a nice-to-have informational
banner, not something that should ever block or alarm anyone over a
transient network hiccup (or a homelab with no outbound internet at all).

GHCR's registry API requires a token even for anonymous/public pulls (no
API key needed, but an unauthenticated request still gets a 401 pointing
at the token endpoint -- this mirrors what `docker pull` itself does
under the hood). The published image is single-platform (this project's
GHCR workflow doesn't set `platforms:`), so `latest` resolves directly to
an image manifest rather than a multi-arch manifest list.

The git revision docker/metadata-action stamps on by default
(`org.opencontainers.image.revision`) can end up as a manifest-level
annotation OR only on the image config's Labels, depending on the
buildx/OCI version involved -- this checks both rather than assuming
one, and gives up (returns checked=False) rather than guessing if
neither is present.
"""

import requests

_REGISTRY = "https://ghcr.io"
_REPO = "syntaxlab-dev/cachepanel"
_REVISION_LABEL = "org.opencontainers.image.revision"
_TIMEOUT = 5


def check_for_update(running_git_sha: str) -> dict:
    if not running_git_sha:
        # Local build, no baked-in SHA to compare against -- nothing to check.
        return {"checked": False, "update_available": False, "latest_sha": None}

    try:
        token = _get_anonymous_token()
        latest_sha = _get_latest_revision(token)
    except (requests.RequestException, KeyError, ValueError, TypeError):
        return {"checked": False, "update_available": False, "latest_sha": None}

    if latest_sha is None:
        return {"checked": False, "update_available": False, "latest_sha": None}

    return {
        "checked": True,
        "update_available": latest_sha != running_git_sha,
        "latest_sha": latest_sha[:7],
    }


def _get_anonymous_token() -> str:
    resp = requests.get(
        f"{_REGISTRY}/token",
        params={"service": "ghcr.io", "scope": f"repository:{_REPO}:pull"},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["token"]


def _get_latest_revision(token: str) -> str | None:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
    }
    manifest_resp = requests.get(
        f"{_REGISTRY}/v2/{_REPO}/manifests/latest", headers=headers, timeout=_TIMEOUT
    )
    manifest_resp.raise_for_status()
    manifest = manifest_resp.json()

    # Try the manifest's own annotations first (cheapest -- no second request).
    revision = manifest.get("annotations", {}).get(_REVISION_LABEL)
    if revision:
        return revision

    # Fall back to the image config blob's Labels.
    config_digest = manifest.get("config", {}).get("digest")
    if not config_digest:
        return None
    config_resp = requests.get(
        f"{_REGISTRY}/v2/{_REPO}/blobs/{config_digest}", headers=headers, timeout=_TIMEOUT
    )
    config_resp.raise_for_status()
    labels = config_resp.json().get("config", {}).get("Labels", {})
    return labels.get(_REVISION_LABEL)
