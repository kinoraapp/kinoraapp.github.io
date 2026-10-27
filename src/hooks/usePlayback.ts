import { useCallback, useEffect, useState } from "react";
import { getPlayback, invalidatePlayback, type PlaybackInfo } from "../lib/playback";

/** Signed stream/poster URLs for one video, fetched only while `enabled`. */
export function usePlayback(videoId: string, shareKey: string | null | undefined, enabled: boolean) {
  const [info, setInfo] = useState<PlaybackInfo | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError(null);
    getPlayback(videoId, shareKey)
      .then((value) => !cancelled && setInfo(value))
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, [videoId, shareKey, enabled, nonce]);

  const refresh = useCallback(() => {
    invalidatePlayback(videoId);
    setNonce((n) => n + 1);
  }, [videoId]);

  return { info, error, refresh, loading: enabled && info === undefined && !error };
}

/** Poster URLs for a grid of videos (one batched request). */
export function usePosters(videoIds: string[]) {
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const key = videoIds.join(",");

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      videoIds.map((id) =>
        getPlayback(id)
          .then((info) => [id, info?.posterUrl ?? null] as const)
          .catch(() => [id, null] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setPosters(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return posters;
}
