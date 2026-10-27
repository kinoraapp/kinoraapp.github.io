// Signs Mux playback tokens (RS256 JWTs) with WebCrypto only, so it runs unchanged in
// Supabase Edge Functions (Deno) and in the Node test suite.
// Docs: https://www.mux.com/docs/guides/secure-video-playback

export type MuxAudience = "v" | "t" | "g" | "s"; // video, thumbnail, gif, storyboard

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const jsonToBase64Url = (value: unknown) => bytesToBase64Url(encoder.encode(JSON.stringify(value)));

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  while (length > 0) {
    bytes.unshift(length & 0xff);
    length >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** Wraps a PKCS#1 RSAPrivateKey (what Mux hands out) in a PKCS#8 PrivateKeyInfo, which WebCrypto imports. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = [0x02, 0x01, 0x00];
  // AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octetString = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...algorithm, ...octetString];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

/** Accepts the base64-encoded PEM shown in the Mux dashboard, or a raw PEM (PKCS#1 or PKCS#8). */
export function privateKeyToPkcs8Der(key: string): Uint8Array<ArrayBuffer> {
  const pem = key.includes("-----BEGIN") ? key : atob(key.trim());
  const body = pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  const der = base64ToBytes(body);
  return pem.includes("BEGIN RSA PRIVATE KEY") ? pkcs1ToPkcs8(der) : der;
}

function importSigningKey(privateKey: string): Promise<CryptoKey> {
  let key = keyCache.get(privateKey);
  if (!key) {
    key = crypto.subtle.importKey(
      "pkcs8",
      privateKeyToPkcs8Der(privateKey),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(privateKey, key);
  }
  return key;
}

export interface MuxTokenOptions {
  keyId: string;
  privateKey: string;
  playbackId: string;
  audience: MuxAudience;
  /** Expiry as a Unix timestamp in seconds. */
  expiresAt: number;
  /** Extra claims, e.g. thumbnail `time` and `width` (signed URLs ignore query parameters). */
  claims?: Record<string, string | number>;
}

export async function signMuxToken(opts: MuxTokenOptions): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: opts.keyId };
  const payload = { ...opts.claims, sub: opts.playbackId, aud: opts.audience, exp: opts.expiresAt, kid: opts.keyId };
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const key = await importSigningKey(opts.privateKey);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}
