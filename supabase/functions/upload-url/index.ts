// POST { videoId }
// Creates a one-time Mux direct-upload URL for a video row the caller owns. The browser uploads
// the file straight to Mux with it, so no Mux credentials ever reach the browser.
import { assertUuid, handle, HttpError, json, readJson, uploadOrigin } from "../_shared/http.ts";
import { mux, type MuxUpload } from "../_shared/mux.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";

Deno.serve(
  handle(async (req) => {
    const { user, client } = await requireUser(req);
    const { videoId: rawId } = await readJson<{ videoId?: unknown }>(req);
    const videoId = assertUuid(rawId, "video id");

    const { data: allowed, error: permError } = await client.rpc("can_upload");
    if (permError) throw permError;
    if (!allowed) throw new HttpError(403, "Your account is not allowed to upload videos");

    const { data: video, error } = await client
      .from("videos")
      .select("id, owner_id, processing_status")
      .eq("id", videoId)
      .maybeSingle();
    if (error) throw error;
    if (!video || video.owner_id !== user.id) throw new HttpError(404, "Video not found");
    if (video.processing_status === "ready" || video.processing_status === "processing") {
      throw new HttpError(409, "This video already has a file");
    }

    const service = serviceClient();
    // Replacing a failed upload: remove the old asset first.
    const { data: secrets } = await service
      .from("video_secrets")
      .select("mux_asset_id")
      .eq("video_id", videoId)
      .maybeSingle();
    if (secrets?.mux_asset_id) {
      await mux(`/video/v1/assets/${secrets.mux_asset_id}`, { method: "DELETE" }).catch(() => undefined);
    }

    const quality = Deno.env.get("MUX_VIDEO_QUALITY") === "plus" ? "plus" : "basic";
    const { data: upload } = await mux<{ data: MuxUpload }>("/video/v1/uploads", {
      method: "POST",
      body: {
        cors_origin: uploadOrigin(req),
        timeout: 3600,
        test: Deno.env.get("MUX_TEST_MODE") === "true",
        new_asset_settings: {
          playback_policies: ["signed"],
          passthrough: videoId,
          video_quality: quality,
          max_resolution_tier: "1080p",
        },
      },
    });

    await service
      .from("video_secrets")
      .update({ mux_upload_id: upload.id, mux_asset_id: null, updated_at: new Date().toISOString() })
      .eq("video_id", videoId);
    await service
      .from("videos")
      .update({ processing_status: "awaiting_upload", processing_error: null, mux_playback_id: null })
      .eq("id", videoId);

    return json(req, { uploadUrl: upload.url, uploadId: upload.id });
  }),
);
