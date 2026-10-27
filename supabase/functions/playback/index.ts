// POST { ids: string[], shareKey?: string }
// Returns short-lived signed stream and poster URLs for the videos the caller may watch.
// Access is decided by the database (playable_videos -> can_view_video) using the caller's own JWT,
// so private videos never get a working URL, even if someone knows the Mux playback ID.
import { assertUuid, handle, HttpError, json, readJson, requireEnv } from "../_shared/http.ts";
import { signMuxToken } from "../_shared/mux-token.ts";
import { getCaller, serviceClient } from "../_shared/supabase.ts";

interface Row {
  id: string;
  mux_playback_id: string | null;
  thumbnail_path: string | null;
  thumbnail_time: number | null;
  processing_status: string;
}

Deno.serve(
  handle(async (req) => {
    const body = await readJson<{ ids?: unknown; shareKey?: unknown }>(req);
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 60) {
      throw new HttpError(400, "Send between 1 and 60 video ids");
    }
    const ids = body.ids.map((id) => assertUuid(id, "video id"));
    const shareKey = typeof body.shareKey === "string" && body.shareKey.length <= 128 ? body.shareKey : null;

    const { client } = await getCaller(req);
    const { data, error } = await client.rpc("playable_videos", { p_ids: ids, p_share_key: shareKey });
    if (error) throw error;
    const rows = (data ?? []) as Row[];

    const ttl = Math.min(Math.max(Number(Deno.env.get("PLAYBACK_TOKEN_TTL_SECONDS") ?? 3600) || 3600, 300), 86_400);
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const keyId = requireEnv("MUX_SIGNING_KEY_ID");
    const privateKey = requireEnv("MUX_SIGNING_KEY_PRIVATE");

    // Custom thumbnails live in a private bucket; sign them with the service role after the access check above.
    const thumbPaths = rows.map((r) => r.thumbnail_path).filter((p): p is string => !!p);
    const signedThumbs = new Map<string, string>();
    if (thumbPaths.length > 0) {
      const { data: signed } = await serviceClient().storage.from("thumbnails").createSignedUrls(thumbPaths, ttl);
      for (const s of signed ?? []) if (s.path && s.signedUrl) signedThumbs.set(s.path, s.signedUrl);
    }

    const items: Record<string, { streamUrl: string | null; posterUrl: string | null; status: string }> = {};
    await Promise.all(
      rows.map(async (row) => {
        const custom = row.thumbnail_path ? signedThumbs.get(row.thumbnail_path) ?? null : null;
        if (row.processing_status !== "ready" || !row.mux_playback_id) {
          items[row.id] = { streamUrl: null, posterUrl: custom, status: row.processing_status };
          return;
        }
        const pid = row.mux_playback_id;
        const [videoToken, thumbToken] = await Promise.all([
          signMuxToken({ keyId, privateKey, playbackId: pid, audience: "v", expiresAt }),
          custom
            ? Promise.resolve(null)
            : signMuxToken({
                keyId,
                privateKey,
                playbackId: pid,
                audience: "t",
                expiresAt,
                claims: { time: Number(row.thumbnail_time ?? 1), width: 720 },
              }),
        ]);
        items[row.id] = {
          streamUrl: `https://stream.mux.com/${pid}.m3u8?token=${videoToken}`,
          posterUrl: custom ?? `https://image.mux.com/${pid}/thumbnail.webp?token=${thumbToken}`,
          status: row.processing_status,
        };
      }),
    );

    return json(req, { items, expiresAt });
  }),
);
