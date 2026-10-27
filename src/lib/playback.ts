// Signed playback links come from the `playback` Edge Function, which checks access in the
// database first. Requests made in the same tick are batched into one call, and links are kept
// in memory only (never in the service worker or localStorage) until shortly before they expire.
import { invokeFunction } from "./api";

export interface PlaybackInfo {
  streamUrl: string | null;
  posterUrl: string | null;
  status: string;
  expiresAt: number;
}

interface Waiter {
  id: string;
  resolve: (info: PlaybackInfo | null) => void;
  reject: (error: unknown) => void;
}

const cache = new Map<string, PlaybackInfo | null>();
const queues = new Map<string, Waiter[]>(); // by share key ("" for none)
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

const cacheKey = (id: string, shareKey: string) => `${id}|${shareKey}`;
const fresh = (info: PlaybackInfo | null | undefined) =>
  info !== undefined && (info === null || info.expiresAt * 1000 - Date.now() > 120_000);

async function flush() {
  timer = null;
  const batches = Array.from(queues.entries());
  queues.clear();
  const gen = generation;
  for (const [shareKey, waiters] of batches) {
    const ids = Array.from(new Set(waiters.map((w) => w.id)));
    for (let i = 0; i < ids.length; i += 60) {
      const chunk = ids.slice(i, i + 60);
      const chunkWaiters = waiters.filter((w) => chunk.includes(w.id));
      try {
        const res = await invokeFunction<{
          items: Record<string, Omit<PlaybackInfo, "expiresAt">>;
          expiresAt: number;
        }>("playback", { ids: chunk, shareKey: shareKey || undefined });
        for (const id of chunk) {
          const item = res.items[id];
          const info = item ? { ...item, expiresAt: res.expiresAt } : null;
          // Only cache playable results; processing videos are asked for again next time.
          if (gen === generation && (info === null || info.streamUrl)) cache.set(cacheKey(id, shareKey), info);
          chunkWaiters.filter((w) => w.id === id).forEach((w) => w.resolve(info));
        }
      } catch (error) {
        chunkWaiters.forEach((w) => w.reject(error));
      }
    }
  }
}

/** Resolves to signed URLs, or null if the caller may not watch the video. */
export function getPlayback(id: string, shareKey?: string | null): Promise<PlaybackInfo | null> {
  const key = shareKey ?? "";
  const cached = cache.get(cacheKey(id, key));
  if (fresh(cached)) return Promise.resolve(cached ?? null);
  return new Promise((resolve, reject) => {
    const list = queues.get(key) ?? [];
    list.push({ id, resolve, reject });
    queues.set(key, list);
    timer ??= setTimeout(flush, 16);
  });
}

/** Drops a cached link, e.g. after the player got a 403 or the video changed. */
export function invalidatePlayback(id: string) {
  for (const key of Array.from(cache.keys())) if (key.startsWith(`${id}|`)) cache.delete(key);
}

/** Called on sign-in and sign-out so one person's links are never reused for another. */
export function clearPlaybackCache() {
  generation++;
  cache.clear();
}
