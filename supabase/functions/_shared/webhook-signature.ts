// Verifies the `mux-signature` header (t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">).
// Docs: https://www.mux.com/docs/core/verify-webhook-signatures

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyMuxSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s.trim());
    if (k === "t") timestamp = Number(v);
    if (k === "v1" && v) signatures.push(v.toLowerCase());
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0 || signatures.length === 0) return false;

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (opts.toleranceSeconds ?? 300)) return false;

  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`)));
  const expected = toHex(mac);
  return signatures.some((sig) => constantTimeEqual(expected, sig));
}
