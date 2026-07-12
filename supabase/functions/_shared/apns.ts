// APNs (token-based) client for Supabase Edge Functions.
//
// Sends a push to Apple using a provider authentication token (JWT, ES256)
// signed with an Apple ".p8" auth key. This is the modern, key-based APNs auth
// (no per-app certificate). Everything secret comes from env - NOTHING is
// hardcoded. A human must set these secrets (see README in this folder):
//
//   APNS_KEY_ID       - the 10-char Key ID for the .p8 key
//   APNS_TEAM_ID      - your 10-char Apple Developer Team ID
//   APNS_BUNDLE_ID    - the app's bundle id (APNs "topic")
//   APNS_PRIVATE_KEY  - the .p8 contents (PEM, may be single-line with \n escapes)
//
// If any are missing, sendPush throws a clear error rather than pretending to
// deliver. Real delivery also requires the Push Notifications capability +
// provisioning on the App ID and a device that actually registered a token.

// deno-lint-ignore-file no-explicit-any

interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKeyPem: string;
}

export function apnsConfigFromEnv(): ApnsConfig {
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const bundleId = Deno.env.get("APNS_BUNDLE_ID");
  const privateKeyPem = Deno.env.get("APNS_PRIVATE_KEY");
  const missing = [
    ["APNS_KEY_ID", keyId],
    ["APNS_TEAM_ID", teamId],
    ["APNS_BUNDLE_ID", bundleId],
    ["APNS_PRIVATE_KEY", privateKeyPem],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `APNs is not configured. Missing secret(s): ${missing.join(", ")}. ` +
        `A human must set these via 'supabase secrets set' before pushes can send.`,
    );
  }
  return {
    keyId: keyId!,
    teamId: teamId!,
    bundleId: bundleId!,
    // Allow the PEM to be stored as a single line with literal "\n".
    privateKeyPem: privateKeyPem!.replace(/\\n/g, "\n"),
  };
}

// --- base64url helpers --------------------------------------------------------
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64urlString(s: string): string {
  return base64url(new TextEncoder().encode(s));
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Sign the APNs provider JWT (header.payload.signature, ES256). Cached ~50 min
// (Apple accepts a token up to 60 min old and rejects re-issuing too often).
let cachedJwt: { token: string; issuedAt: number } | null = null;

async function providerToken(cfg: ApnsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.issuedAt < 50 * 60) return cachedJwt.token;

  const header = { alg: "ES256", kid: cfg.keyId };
  const claims = { iss: cfg.teamId, iat: now };
  const signingInput =
    `${base64urlString(JSON.stringify(header))}.${base64urlString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(cfg.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  const token = `${signingInput}.${base64url(sig)}`;
  cachedJwt = { token, issuedAt: now };
  return token;
}

export interface PushResult {
  token: string;
  ok: boolean;
  status: number;
  reason?: string;
}

// Send one alert push to a single device token.
export async function sendPush(
  cfg: ApnsConfig,
  deviceToken: string,
  payload: { title: string; body: string },
  environment: "sandbox" | "production" = "sandbox",
): Promise<PushResult> {
  const jwt = await providerToken(cfg);
  const host = environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";

  const res = await fetch(`${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
      },
    }),
  });

  let reason: string | undefined;
  if (!res.ok) {
    try {
      const j: any = await res.json();
      reason = j?.reason;
    } catch {
      reason = await res.text().catch(() => undefined);
    }
  } else {
    await res.body?.cancel();
  }
  return { token: deviceToken, ok: res.ok, status: res.status, reason };
}
