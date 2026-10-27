// POST { videoId }
// Permanently deletes a video: the Mux asset (or pending upload), custom thumbnails and the
// database row with its likes, comments and access grants. Owner or administrator only.
import { assertUuid, handle, HttpError, json, readJson } from "../_shared/http.ts";
import { mux } from "../_shared/mux.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";

Deno.serve(
  handle(async (req) => {
    const { user, client } = await requireUser(req);
    const { videoId: rawId } = await readJson<{ videoId?: unknown }>(req);
    const videoId = assertUuid(rawId, "video id");

    const { data: video, error } = await client.from("videos").select("id, owner_id").eq("id", videoId).maybeSingle();
    if (error) throw error;
    if (!video) throw new HttpError(404, "Video not found");
    if (video.owner_id !== user.id) {
      const { data: isAdmin } = await client.rpc("is_admin");
      if (!isAdmin) throw new HttpError(403, "Only the owner or an administrator can delete this video");
    } else {
      const { data: active } = await client.rpc("is_active_user");
      if (!active) throw new HttpError(403, "Your account is suspended");
    }

    const service = serviceClient();
    const { data: secrets } = await service
      .from("video_secrets")
      .select("mux_upload_id, mux_asset_id")
      .eq("video_id", videoId)
      .maybeSingle();
    if (secrets?.mux_asset_id) {
      await mux(`/video/v1/assets/${secrets.mux_asset_id}`, { method: "DELETE" }).catch((e) => {
        if (!(e instanceof HttpError && e.status === 404)) throw e; // already gone is fine
      });
    } else if (secrets?.mux_upload_id) {
      await mux(`/video/v1/uploads/${secrets.mux_upload_id}/cancel`, { method: "PUT" }).catch(() => undefined);
    }

    const folder = `${video.owner_id}/${videoId}`;
    const { data: files } = await service.storage.from("thumbnails").list(folder, { limit: 100 });
    if (files && files.length > 0) {
      await service.storage.from("thumbnails").remove(files.map((f) => `${folder}/${f.name}`));
    }

    const { error: deleteError } = await service.from("videos").delete().eq("id", videoId);
    if (deleteError) throw deleteError;
    return json(req, { deleted: true });
  }),
);
