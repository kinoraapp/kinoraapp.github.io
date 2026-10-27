// POST { videoId }
// Asks Mux for the current state of a video's upload/asset and saves it. The webhook normally
// does this; this function lets the upload page finish even when webhooks are not set up yet
// (for example during local development).
import { assertUuid, handle, HttpError, json, readJson } from "../_shared/http.ts";
import { applyAsset, markFailed, mux, type MuxAsset, type MuxUpload } from "../_shared/mux.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";

Deno.serve(
  handle(async (req) => {
    const { user, client } = await requireUser(req);
    const { videoId: rawId } = await readJson<{ videoId?: unknown }>(req);
    const videoId = assertUuid(rawId, "video id");

    const { data: video, error } = await client
      .from("videos")
      .select("id, owner_id, processing_status")
      .eq("id", videoId)
      .maybeSingle();
    if (error) throw error;
    if (!video) throw new HttpError(404, "Video not found");
    if (video.owner_id !== user.id) {
      const { data: isAdmin } = await client.rpc("is_admin");
      if (!isAdmin) throw new HttpError(403, "Not allowed");
    }
    if (video.processing_status === "ready") return json(req, { status: "ready" });

    const service = serviceClient();
    const { data: secrets } = await service
      .from("video_secrets")
      .select("mux_upload_id, mux_asset_id")
      .eq("video_id", videoId)
      .single();
    if (!secrets?.mux_upload_id && !secrets?.mux_asset_id) return json(req, { status: video.processing_status });

    let assetId = secrets.mux_asset_id as string | null;
    if (!assetId) {
      const { data: upload } = await mux<{ data: MuxUpload }>(`/video/v1/uploads/${secrets.mux_upload_id}`);
      if (upload.status === "waiting") return json(req, { status: "awaiting_upload" });
      if (upload.status !== "asset_created" || !upload.asset_id) {
        await markFailed(service, videoId, upload.error?.message ?? `Upload ${upload.status}`);
        return json(req, { status: "errored" });
      }
      assetId = upload.asset_id;
    }
    const { data: asset } = await mux<{ data: MuxAsset }>(`/video/v1/assets/${assetId}`);
    const status = await applyAsset(service, videoId, asset);
    return json(req, { status });
  }),
);
