import { createHmac, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pkcs1ToPkcs8, signMuxToken } from "../../supabase/functions/_shared/mux-token";
import { verifyMuxSignature } from "../../supabase/functions/_shared/webhook-signature";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("Mux playback tokens", () => {
  // Mux hands out PKCS#1 ("BEGIN RSA PRIVATE KEY") keys, base64-encoded.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const muxStyleKey = Buffer.from(privateKey).toString("base64");

  it("signs a verifiable RS256 token with the claims Mux expects", async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await signMuxToken({
      keyId: "key123",
      privateKey: muxStyleKey,
      playbackId: "abcPLAYBACK",
      audience: "t",
      expiresAt: exp,
      claims: { time: 2, width: 720 },
    });
    const [h, p, s] = token.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT", kid: "key123" });
    expect(decode(p)).toEqual({ sub: "abcPLAYBACK", aud: "t", exp, kid: "key123", time: 2, width: 720 });
    const ok = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey(publicKey), Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it("also accepts a raw PEM key", async () => {
    const token = await signMuxToken({
      keyId: "k",
      privateKey,
      playbackId: "x",
      audience: "v",
      expiresAt: 1,
    });
    const [h, p, s] = token.split(".");
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey(publicKey), Buffer.from(s, "base64url"))).toBe(true);
  });

  it("does not let extra claims override the subject or audience", async () => {
    const token = await signMuxToken({
      keyId: "k",
      privateKey: muxStyleKey,
      playbackId: "real",
      audience: "v",
      expiresAt: 1,
      claims: { sub: "other", aud: "t" },
    });
    expect(decode(token.split(".")[1])).toMatchObject({ sub: "real", aud: "v" });
  });

  it("wraps PKCS#1 keys in a valid PKCS#8 structure", () => {
    const der = pkcs1ToPkcs8(new Uint8Array(300).fill(1));
    expect(der[0]).toBe(0x30);
    expect(der.length).toBe(300 + 4 + 3 + 15 + 4);
  });
});

describe("Mux webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "video.asset.ready", data: { id: "asset1" } });
  const sign = (t: number, b = body) => createHmac("sha256", secret).update(`${t}.${b}`).digest("hex");

  it("accepts a correctly signed, recent request", async () => {
    const t = Math.floor(Date.now() / 1000);
    expect(await verifyMuxSignature(`t=${t},v1=${sign(t)}`, body, secret)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, old timestamps and missing headers", async () => {
    const t = Math.floor(Date.now() / 1000);
    expect(await verifyMuxSignature(`t=${t},v1=${sign(t)}`, body + " ", secret)).toBe(false);
    expect(await verifyMuxSignature(`t=${t},v1=${sign(t)}`, body, "other")).toBe(false);
    const old = t - 3600;
    expect(await verifyMuxSignature(`t=${old},v1=${sign(old)}`, body, secret)).toBe(false);
    expect(await verifyMuxSignature(null, body, secret)).toBe(false);
    expect(await verifyMuxSignature(`t=${t}`, body, secret)).toBe(false);
  });
});
