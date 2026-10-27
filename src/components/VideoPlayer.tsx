import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type Hls from "hls.js";
import { AlertTriangle, Heart, Lock, Pause, Play, RefreshCw } from "lucide-react";
import { usePlayback } from "../hooks/usePlayback";
import { Spinner } from "./Feedback";

interface Props {
  videoId: string;
  shareKey?: string | null;
  /** The visible video plays; others pause. */
  active: boolean;
  /** Attach the stream (current video and its neighbours). Detached players download nothing. */
  load: boolean;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  fit?: "cover" | "contain";
  onDoubleTap?: () => void;
  /** Fires once, after two seconds of playback. */
  onWatched?: () => void;
  posterOverride?: string | null;
}

const canPlayHlsNatively = () => document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";

/**
 * Safari (Mac, iPhone, iPad) plays HLS natively and reliably. Some Chromium builds also claim
 * native HLS but can't play the fMP4 segments Mux serves, so everything else uses hls.js.
 */
const isAppleWebKit = () => navigator.vendor === "Apple Computer, Inc." || /iPad|iPhone|iPod/.test(navigator.userAgent);

export function VideoPlayer({
  videoId,
  shareKey,
  active,
  load,
  muted,
  onMutedChange,
  fit = "cover",
  onDoubleTap,
  onWatched,
  posterOverride,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const { info, error: linkError, refresh, loading } = usePlayback(videoId, shareKey, load || active);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "error" | "blocked">("idle");
  const [progress, setProgress] = useState(0);
  const [flash, setFlash] = useState<"play" | "pause" | "heart" | null>(null);
  const retried = useRef(false);
  const watched = useRef(false);
  const playTime = useRef(0);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamUrl = info?.streamUrl ?? null;

  // Attach / detach the stream.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl || !(load || active)) return;
    let cancelled = false;
    setState("loading");

    const onFatal = (status?: number) => {
      // Signed links expire; get a fresh one once before showing an error.
      if ((status === 403 || status === 401) && !retried.current) {
        retried.current = true;
        refresh();
        return;
      }
      setState("error");
    };

    const onNativeError = () => onFatal();
    const attachNative = () => {
      video.addEventListener("error", onNativeError);
      video.src = streamUrl;
      video.load();
    };
    const fallback = () => {
      if (cancelled) return;
      if (canPlayHlsNatively()) attachNative();
      else setState("error");
    };
    const cleanup = () => {
      cancelled = true;
      video.removeEventListener("error", onNativeError);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    if (isAppleWebKit() && canPlayHlsNatively()) {
      attachNative();
      return cleanup;
    }

    import("hls.js").then(({ default: HlsCtor }) => {
      if (cancelled) return;
      if (!HlsCtor.isSupported()) {
        fallback();
        return;
      }
      const hls = new HlsCtor({
        capLevelToPlayerSize: true, // don't fetch 1080p for a phone-sized player
        maxBufferLength: active ? 20 : 6, // neighbours only pre-buffer a few seconds
        startLevel: -1,
        enableWorker: true,
      });
      hlsRef.current = hls;
      hls.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        const status = (data.response as { code?: number } | undefined)?.code;
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          onFatal(status);
        }
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
    }, fallback);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, load || active]);

  // Raise the buffer once a pre-loaded neighbour becomes the active video.
  useEffect(() => {
    if (hlsRef.current) hlsRef.current.config.maxBufferLength = active ? 20 : 6;
  }, [active]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  // Play the active video, pause the rest.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;
    if (active) {
      video.muted = muted;
      video.play().catch(() => {
        // Autoplay with sound is blocked until the user interacts: retry muted.
        if (!video.muted) {
          video.muted = true;
          onMutedChange(true);
          video.play().catch(() => setState("blocked"));
        } else {
          setState("blocked");
        }
      });
    } else {
      video.pause();
      if (video.currentTime > 0) video.currentTime = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, streamUrl]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || state === "error") return;
    if (video.paused) {
      video.play().catch(() => setState("blocked"));
      setFlash("play");
    } else {
      video.pause();
      setFlash("pause");
    }
    setTimeout(() => setFlash(null), 600);
  }, [state]);

  const onTap = () => {
    const now = Date.now();
    if (onDoubleTap && now - lastTap.current < 280) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = 0;
      onDoubleTap();
      setFlash("heart");
      setTimeout(() => setFlash(null), 700);
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(togglePlay, onDoubleTap ? 280 : 0);
  };

  const seek = (e: PointerEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    video.currentTime = ratio * video.duration;
    setProgress(ratio);
  };

  const poster = posterOverride ?? info?.posterUrl ?? undefined;
  const noAccess = info === null;
  const processing = info && !info.streamUrl;

  return (
    <div className={`player player-${fit}`}>
      {poster && <div className="player-backdrop" style={{ backgroundImage: `url("${poster}")` }} aria-hidden />}
      <video
        ref={(el) => {
          videoRef.current = el;
          // Safari needs the attribute (not just the property) for muted autoplay.
          if (el && muted) el.setAttribute("muted", "");
        }}
        className="player-video"
        poster={poster}
        playsInline
        loop
        preload={active ? "auto" : "metadata"}
        disableRemotePlayback
        onPlaying={() => setState("playing")}
        onPause={() => setState((s) => (s === "error" ? s : "paused"))}
        onWaiting={() => setState("loading")}
        onCanPlay={() => setState((s) => (s === "loading" ? (videoRef.current?.paused ? "paused" : "playing") : s))}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration) setProgress(v.currentTime / v.duration);
          if (!watched.current && !v.paused) {
            playTime.current += 0.25;
            if (playTime.current >= 2) {
              watched.current = true;
              onWatched?.();
            }
          }
        }}
        aria-label="Video"
      />
      <button type="button" className="player-tap" onClick={onTap} aria-label={state === "playing" ? "Pause" : "Play"} />

      {(loading || (state === "loading" && (load || active))) && !noAccess && (
        <div className="player-center" aria-hidden>
          <Spinner size={40} />
        </div>
      )}
      {(state === "paused" || state === "blocked") && active && !flash && (
        <div className="player-center player-paused-icon" aria-hidden>
          <Play size={56} fill="currentColor" />
        </div>
      )}
      {flash && (
        <div className={`player-center player-flash player-flash-${flash}`} aria-hidden>
          {flash === "play" ? (
            <Play size={56} fill="currentColor" />
          ) : flash === "pause" ? (
            <Pause size={56} fill="currentColor" />
          ) : (
            <Heart size={96} fill="currentColor" />
          )}
        </div>
      )}
      {(state === "error" || !!linkError) && (
        <div className="player-center player-message" role="alert">
          <AlertTriangle size={32} />
          <p>This video couldn't be played.</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              retried.current = false;
              refresh();
            }}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}
      {noAccess && (
        <div className="player-center player-message">
          <Lock size={32} />
          <p>This video is private or no longer available.</p>
        </div>
      )}
      {processing && (
        <div className="player-center player-message">
          <Spinner size={32} />
          <p>{info?.status === "errored" ? "Processing failed." : "This video is still processing…"}</p>
        </div>
      )}

      <div
        className="player-progress"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={-1}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && seek(e)}
      >
        <div className="player-progress-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}
