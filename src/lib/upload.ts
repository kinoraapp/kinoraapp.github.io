import { UpChunk } from "@mux/upchunk";
import { env } from "../config/env";
import { refreshVideoStatus } from "./api";

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface VideoFileInfo {
  duration: number | null;
  width: number | null;
  height: number | null;
}

/** Checks type and size; returns an error message or null. */
export function validateVideoFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const typeOk = ACCEPTED_VIDEO_TYPES.includes(file.type) || ["mp4", "webm", "mov", "m4v"].includes(ext ?? "");
  if (!typeOk) return "Choose an MP4, WebM or MOV video.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > env.maxUploadMb * 1024 * 1024) return `Videos can be up to ${env.maxUploadMb} MB.`;
  return null;
}

/** Reads duration and size from the file in the browser (no upload needed). */
export function readVideoInfo(url: string): Promise<VideoFileInfo> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = (info: VideoFileInfo) => {
      video.removeAttribute("src");
      video.load();
      resolve(info);
    };
    video.onloadedmetadata = () =>
      done({
        duration: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    // Some formats (e.g. HEVC .mov on Chrome) can't be previewed here but still upload fine.
    video.onerror = () => done({ duration: null, width: null, height: null });
    setTimeout(() => done({ duration: null, width: null, height: null }), 8000);
    video.src = url;
  });
}

/** Grabs the current frame of a <video> as a JPEG for the thumbnail. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.width) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.86));
}

export interface UploadHandle {
  done: Promise<void>;
  abort: () => void;
}

/**
 * Sends the file straight to Mux in resumable 5 MB chunks (retries on flaky mobile connections).
 * Only the one-time upload URL from our Edge Function is used, never Mux credentials.
 */
export function uploadToMux(file: File, uploadUrl: string, onProgress: (percent: number) => void): UploadHandle {
  const upload = UpChunk.createUpload({ endpoint: uploadUrl, file, chunkSize: 5120, attempts: 5 });
  const done = new Promise<void>((resolve, reject) => {
    upload.on("progress", (e) => onProgress(Math.round(Number(e.detail) || 0)));
    upload.on("success", () => resolve());
    upload.on("error", (e) => reject(new Error((e.detail as { message?: string })?.message ?? "Upload failed")));
  });
  return { done, abort: () => upload.abort() };
}

/** Polls until Mux has finished processing (the webhook usually gets there first). */
export async function waitUntilProcessed(
  videoId: string,
  onStatus: (status: string) => void,
  signal: { cancelled: boolean },
): Promise<string> {
  const started = Date.now();
  let delay = 3000;
  while (!signal.cancelled && Date.now() - started < 15 * 60_000) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const { status } = await refreshVideoStatus(videoId);
      onStatus(status);
      if (status === "ready" || status === "errored") return status;
    } catch {
      // Keep polling through brief network errors.
    }
    delay = Math.min(delay * 1.3, 10_000);
  }
  return "processing";
}
