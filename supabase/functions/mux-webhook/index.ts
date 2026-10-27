// Receives Mux webhooks (configure the URL in the Mux dashboard). Requests are accepted only
// with a valid `mux-signature` made with MUX_WEBHOOK_SECRET.
import { verifyMuxSignature } from "../_shared/webhook-signature.ts";
import { applyAsset, markFailed, type MuxAsset, type MuxUpload } from "../_shared/mux.ts";
import { serviceClient } from "../_shared/supabase.ts";

type Service = ReturnType<typeof serviceClient>;

async function videoIdFor(service: Service, column: "mux_upload_id" | "mux_asset_id", value?: string) {
  if (!value) return null;
  const { data } = await service.from("video_secrets").select("video_id").eq(column, value).maybeSingle();
  return (data?.video_id as string | undefined) ?? null;
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("MUX_WEBHOOK_SECRET") ?? "";
  if (!secret) return respond({ error: "MUX_WEBHOOK_SECRET is not set" }, 500);

  const raw = await req.text();
  if (!(await verifyMuxSignature(req.headers.get("mux-signature"), raw, secret))) {
    return respond({ error: "Invalid signature" }, 401);
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return respond({ error: "Invalid JSON" }, 400);
  }
  const service = serviceClient();
  const data = event.data ?? {};

  try {
    switch (event.type) {
      case "video.upload.asset_created": {
        const upload = data as unknown as MuxUpload;
        const videoId = upload.new_asset_settings?.passthrough ?? (await videoIdFor(service, "mux_upload_id", upload.id));
        if (videoId && upload.asset_id) {
          await service.from("video_secrets").update({ mux_asset_id: upload.asset_id }).eq("video_id", videoId);
          await service.from("videos").update({ processing_status: "processing" }).eq("id", videoId);
        }
        break;
      }
      case "video.asset.created":
      case "video.asset.ready":
      case "video.asset.errored": {
        const asset = data as unknown as MuxAsset;
        const videoId =
          (await videoIdFor(service, "mux_asset_id", asset.id)) ??
          (await videoIdFor(service, "mux_upload_id", asset.upload_id)) ??
          asset.passthrough ??
          null;
        if (videoId) await applyAsset(service, videoId, asset);
        break;
      }
      case "video.upload.errored":
      case "video.upload.cancelled":
      case "video.upload.timed_out": {
        const upload = data as unknown as MuxUpload;
        const videoId = await videoIdFor(service, "mux_upload_id", upload.id);
        if (videoId) await markFailed(service, videoId, upload.error?.message ?? "The upload did not complete");
        break;
      }
      default:
        break; // Other events are not needed.
    }
  } catch (error) {
    console.error("Webhook handling failed", event.type, error);
    return respond({ error: "Handler failed" }, 500); // Mux retries failed deliveries.
  }
  return respond({ received: true });
});
