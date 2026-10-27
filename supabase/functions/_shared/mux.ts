// Minimal Mux Video API client plus the shared "copy asset state onto our video row" logic.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, requireEnv } from "./http.ts";

const MUX_API = "https://api.mux.com";

export async function mux<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const auth = btoa(`${requireEnv("MUX_TOKEN_ID")}:${requireEnv("MUX_TOKEN_SECRET")}`);
  const res = await fetch(`${MUX_API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    console.error(`Mux ${init.method ?? "GET"} ${path} failed: ${res.status} ${text}`);
    throw new HttpError(res.status === 404 ? 404 : 502, "The video service rejected the request");
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface MuxAsset {
  id: string;
  status: "preparing" | "ready" | "errored";
  passthrough?: string;
  upload_id?: string;
  duration?: number;
  aspect_ratio?: string;
  playback_ids?: { id: string; policy: "public" | "signed" | "drm" }[];
  errors?: { type?: string; messages?: string[] };
}

export interface MuxUpload {
  id: string;
  url: string;
  status: "waiting" | "asset_created" | "errored" | "cancelled" | "timed_out";
  asset_id?: string;
  new_asset_settings?: { passthrough?: string };
  error?: { type?: string; message?: string };
}

/** Copies a Mux asset's state onto the video row (used by the webhook and by video-status). */
export async function applyAsset(service: SupabaseClient, videoId: string, asset: MuxAsset): Promise<string> {
  await service
    .from("video_secrets")
    .update({ mux_asset_id: asset.id, updated_at: new Date().toISOString() })
    .eq("video_id", videoId);

  let update: Record<string, unknown>;
  if (asset.status === "ready") {
    const playback = asset.playback_ids?.find((p) => p.policy === "signed");
    update = playback
      ? {
          processing_status: "ready",
          processing_error: null,
          mux_playback_id: playback.id,
          duration_seconds: asset.duration ?? null,
          aspect_ratio: asset.aspect_ratio ?? null,
        }
      : { processing_status: "errored", processing_error: "The video has no signed playback ID" };
  } else if (asset.status === "errored") {
    update = {
      processing_status: "errored",
      processing_error: asset.errors?.messages?.join("; ") || "The video could not be processed",
    };
  } else {
    update = { processing_status: "processing", processing_error: null };
  }
  const { error } = await service.from("videos").update(update).eq("id", videoId);
  if (error) throw error;
  return update.processing_status as string;
}

export async function markFailed(service: SupabaseClient, videoId: string, message: string) {
  await service.from("videos").update({ processing_status: "errored", processing_error: message }).eq("id", videoId);
}
