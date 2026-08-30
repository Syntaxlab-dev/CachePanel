import { api } from "@/lib/api";

// Manual base64url<->ArrayBuffer conversion rather than pulling in
// @simplewebauthn/browser for it -- same "no dependency for a few lines"
// choice as Settings.tsx's urlBase64ToUint8Array() for Web Push, and it
// keeps this working on browsers that don't yet implement the newer
// PublicKeyCredential.prototype.toJSON()/parseCreationOptionsFromJSON
// convenience methods (WebAuthn Level 3, only broadly available since
// early 2024) -- the raw navigator.credentials API these functions wrap
// has been stable and universal for far longer.
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
  return buffer.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface CredentialDescriptorJson {
  id: string;
  type: "public-key";
  transports?: AuthenticatorTransport[];
}

function decodeCredentialDescriptors(
  list: CredentialDescriptorJson[] | undefined,
): PublicKeyCredentialDescriptor[] | undefined {
  if (!list) return undefined;
  return list.map((c) => ({ ...c, id: base64urlToBuffer(c.id) }));
}

// registration/authentication attempts can throw for entirely normal
// reasons (the user cancelled the OS/browser passkey prompt, no
// authenticator is available, this isn't a secure context) -- callers
// show a generic error toast either way, this is just a single place to
// recognize a user-initiated cancel isn't worth alarming wording for.
export function isUserCancelled(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

export function isPasskeySupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

export async function registerPasskey(label: string): Promise<void> {
  const options = (await api.webauthnRegisterBegin()) as unknown as {
    challenge: string;
    rp: PublicKeyCredentialRpEntity;
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: PublicKeyCredentialParameters[];
    timeout?: number;
    excludeCredentials?: CredentialDescriptorJson[];
    authenticatorSelection?: AuthenticatorSelectionCriteria;
    attestation?: AttestationConveyancePreference;
  };

  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    user: { ...options.user, id: base64urlToBuffer(options.user.id) },
    excludeCredentials: decodeCredentialDescriptors(options.excludeCredentials),
  };

  const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
  const response = credential.response as AuthenticatorAttestationResponse;

  await api.webauthnRegisterComplete(
    {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        attestationObject: bufferToBase64url(response.attestationObject),
      },
    },
    label,
  );
}

export async function loginWithPasskey(): Promise<void> {
  const options = (await api.webauthnLoginBegin()) as unknown as {
    challenge: string;
    timeout?: number;
    rpId?: string;
    allowCredentials?: CredentialDescriptorJson[];
    userVerification?: UserVerificationRequirement;
  };

  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    allowCredentials: decodeCredentialDescriptors(options.allowCredentials),
  };

  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
  const response = credential.response as AuthenticatorAssertionResponse;

  await api.webauthnLoginComplete({
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  });
}
