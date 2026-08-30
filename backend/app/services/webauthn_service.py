"""Passkey/WebAuthn registration and login ceremonies (4th feature round,
Welle 2). Wraps the `webauthn` PyPI package (duo-labs/py_webauthn 3.0.0) --
its actual API (as installed, not from memory) was verified against a real
registration+authentication round-trip using a simulated software
authenticator (soft-webauthn) before this was written, including that a
replayed/stale sign_count is correctly rejected. See routers/auth.py's
/webauthn/* endpoints for how this plugs into the login flow.

RP ID / origin, and their real-world limitation:
WebAuthn binds every credential to the exact hostname (RP ID) and origin
it was created under. Both are derived here from the *current request's*
Host header (request.url.hostname / f"{scheme}://{netloc}"), not
hardcoded -- so registering and logging in both work correctly whichever
hostname the panel happens to be reached through. What this can NOT paper
over: a passkey registered while visiting the panel via one hostname will
NOT work when logging in via a different hostname (e.g. registered via
the NPM-proxied domain, then attempting login via the bare LAN IP) --
that's WebAuthn's own security model, not a bug here. More importantly:
navigator.credentials.create()/get() only work in a "secure context", and
per the W3C spec that means HTTPS, or the special-cased localhost/loopback
-- an arbitrary LAN IP over plain HTTP (this app's other, non-passkey
access path, see main.py's SessionMiddleware https_only=False comment)
is NOT a secure context in any mainstream browser. In practice this means
passkeys only work when CachePanel is reached over HTTPS (e.g. via the
lancache.waifulab.net NPM reverse proxy this instance already runs behind
for other reasons), never via a direct http://<lan-ip>:8090 visit -- the
password(+TOTP) login path is unaffected and remains the fallback for
that access method. This is a real, unavoidable browser platform
restriction, not something this feature can work around.
"""

import hashlib
import json

import webauthn
from fastapi import Request
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.services import webauthn_credential_store

_RP_NAME = "CachePanel"


class WebAuthnError(Exception):
    pass


def _rp_id(request: Request) -> str:
    return request.url.hostname or "localhost"


def _origin(request: Request) -> str:
    return f"{request.url.scheme}://{request.url.netloc}"


def _user_handle(username: str) -> bytes:
    """A stable, opaque per-account handle for WebAuthn's user.id field --
    deliberately not the raw username bytes (the spec recommends the
    handle not directly encode identifying information), and deterministic
    so exclude_credentials in begin_registration() can recognize a device
    already registered to this account across multiple registration
    attempts without a separate id column anywhere."""
    return hashlib.sha256(username.encode("utf-8")).digest()


def begin_registration(request: Request, username: str) -> dict:
    existing = webauthn_credential_store.list_for_user(username)
    options = webauthn.generate_registration_options(
        rp_id=_rp_id(request),
        rp_name=_RP_NAME,
        user_name=username,
        user_id=_user_handle(username),
        user_display_name=username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"])) for c in existing
        ],
    )
    request.session["webauthn_reg_challenge"] = webauthn.helpers.bytes_to_base64url(options.challenge)
    request.session["webauthn_reg_username"] = username
    # options_to_json() returns an already-serialized JSON *string* (for a
    # caller that writes it straight into an HTTP body itself) -- parsed
    # back into a dict here since this returns through a FastAPI route,
    # which JSON-encodes whatever it's given; returning the string as-is
    # would have gotten it encoded a second time, arriving in the browser
    # as a quoted string instead of the options object it expects.
    return json.loads(webauthn.options_to_json(options))


def complete_registration(request: Request, credential_json: str, label: str) -> None:
    challenge_b64 = request.session.pop("webauthn_reg_challenge", None)
    username = request.session.pop("webauthn_reg_username", None)
    if not challenge_b64 or not username:
        raise WebAuthnError("no_pending_registration")

    try:
        verified = webauthn.verify_registration_response(
            credential=credential_json,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=_rp_id(request),
            expected_origin=_origin(request),
        )
    except Exception as exc:  # noqa: BLE001 -- any verification failure is treated the same, see routers/auth.py
        raise WebAuthnError("verification_failed") from exc

    webauthn_credential_store.add(
        credential_id=webauthn.helpers.bytes_to_base64url(verified.credential_id),
        username=username,
        public_key=webauthn.helpers.bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
        rp_id=_rp_id(request),
        label=label,
    )


def begin_authentication(request: Request) -> dict:
    """No username/allow_credentials -- relies on the authenticator's own
    discoverable-credential UI to offer a matching passkey for this RP ID,
    which is what makes a passkey a full replacement for typing a username
    at all. See module docstring for the resident-key caveat on
    authenticators that don't support this."""
    options = webauthn.generate_authentication_options(
        rp_id=_rp_id(request),
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    request.session["webauthn_auth_challenge"] = webauthn.helpers.bytes_to_base64url(options.challenge)
    return json.loads(webauthn.options_to_json(options))


def complete_authentication(request: Request, credential_json: str) -> str:
    """Returns the username on success, or raises WebAuthnError."""
    challenge_b64 = request.session.pop("webauthn_auth_challenge", None)
    if not challenge_b64:
        raise WebAuthnError("no_pending_authentication")

    try:
        parsed = credential_json if isinstance(credential_json, dict) else json.loads(credential_json)
        credential_id = webauthn.helpers.bytes_to_base64url(base64url_to_bytes(parsed["id"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise WebAuthnError("malformed_credential") from exc

    stored = webauthn_credential_store.get_by_credential_id(credential_id)
    if stored is None:
        raise WebAuthnError("unknown_credential")

    try:
        verified = webauthn.verify_authentication_response(
            credential=credential_json,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=_rp_id(request),
            expected_origin=_origin(request),
            credential_public_key=base64url_to_bytes(stored["public_key"]),
            credential_current_sign_count=stored["sign_count"],
        )
    except Exception as exc:  # noqa: BLE001 -- any verification failure (incl. a rejected replayed sign_count)
        raise WebAuthnError("verification_failed") from exc

    webauthn_credential_store.update_sign_count(credential_id, verified.new_sign_count)
    return stored["username"]
