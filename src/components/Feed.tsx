import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bookmark,
  Ellipsis,
  ExternalLink,
  Flag,
  Heart,
  Maximize,
  MessageCircle,
  Plus,
  Share2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { recordView, setFollowing } from "../lib/api";
import { captionParts, compactNumber } from "../lib/format";
import type { VideoCard } from "../lib/types";
import { Avatar } from "./Brand";
import { CommentsPanel } from "./Comments";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { ReportDialog, SaveDialog, ShareDialog, useRequireSignIn, useVideoSocial } from "./VideoActions";
import { VideoPlayer } from "./VideoPlayer";

export interface ViewerState {
  liked: Set<string>;
  saved: Set<string>;
  following: Set<string>;
}

/** Portrait videos fill the screen; landscape and square videos are letterboxed. */
export function fitFor(aspect: string | null): "cover" | "contain" {
  if (!aspect) return "cover";
  const [w, h] = aspect.split(":").map(Number);
  return w && h && w / h < 0.7 ? "cover" : "contain";
}

export function Caption({ text, clamp = true }: { text: string; clamp?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  return (
    <p className={`caption${clamp && !expanded ? " caption-clamped" : ""}`} onClick={() => setExpanded((e) => !e)}>
      {captionParts(text).map((p, i) =>
        p.tag ? (
          <Link key={i} to={`/explore?tag=${encodeURIComponent(p.tag)}`} className="hashtag" onClick={(e) => e.stopPropagation()}>
            {p.text}
          </Link>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

function FeedItem({
  video,
  index,
  active,
  load,
  muted,
  setMuted,
  viewer,
  onFollowChange,
}: {
  video: VideoCard;
  index: number;
  active: boolean;
  load: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  viewer: ViewerState;
  onFollowChange: (userId: string, following: boolean) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const requireSignIn = useRequireSignIn();
  const social = useVideoSocial(video, { liked: viewer.liked.has(video.id), saved: viewer.saved.has(video.id) });
  const [commentCount, setCommentCount] = useState(video.comment_count);
  const [panel, setPanel] = useState<"comments" | "share" | "save" | "more" | "report" | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const following = viewer.following.has(video.owner_id);
  const isMine = user?.id === video.owner_id;

  const follow = () =>
    requireSignIn(async () => {
      onFollowChange(video.owner_id, true);
      try {
        await setFollowing(video.owner_id, true);
        toast.success(`Following @${video.username}`);
      } catch (e) {
        onFollowChange(video.owner_id, false);
        toast.error(e);
      }
    });

  const fullscreen = () => {
    const box = boxRef.current;
    const videoEl = box?.querySelector("video") as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (box?.requestFullscreen) box.requestFullscreen().catch(() => undefined);
    else videoEl?.webkitEnterFullscreen?.(); // iPhone Safari
  };

  return (
    <section className="feed-item" data-index={index} aria-label={`${video.title} by @${video.username}`}>
      <div className="feed-stage">
        <div className="feed-box" ref={boxRef}>
          <VideoPlayer
            videoId={video.id}
            active={active}
            load={load}
            muted={muted}
            onMutedChange={setMuted}
            fit={fitFor(video.aspect_ratio)}
            onDoubleTap={() => social.toggleLike(true)}
            onWatched={() => recordView(video.id).catch(() => undefined)}
          />
          <div className="feed-top-controls">
            <button
              type="button"
              className="icon-btn icon-btn-glass"
              onClick={() => setMuted(!muted)}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <button type="button" className="icon-btn icon-btn-glass" onClick={fullscreen} aria-label="Full screen">
              <Maximize size={20} />
            </button>
          </div>
          {muted && active && (
            <button type="button" className="unmute-pill" onClick={() => setMuted(false)}>
              <VolumeX size={16} /> Tap to unmute
            </button>
          )}
          <div className="feed-info">
            <Link to={`/u/${video.username}`} className="feed-author">
              @{video.username}
            </Link>
            <Link to={`/v/${video.id}`} className="feed-title">
              {video.title}
            </Link>
            <Caption text={video.caption} />
          </div>
        </div>

        <div className="rail">
          <div className="rail-avatar">
            <Link to={`/u/${video.username}`} aria-label={`Open @${video.username}'s profile`}>
              <Avatar src={video.avatar_url} name={video.username} size={46} />
            </Link>
            {!isMine && !following && (
              <button type="button" className="rail-follow" onClick={follow} aria-label={`Follow @${video.username}`}>
                <Plus size={14} strokeWidth={3} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={`rail-btn${social.liked ? " is-liked" : ""}`}
            onClick={() => social.toggleLike()}
            aria-pressed={social.liked}
            aria-label={social.liked ? "Unlike" : "Like"}
          >
            <span className="rail-icon">
              <Heart size={28} fill={social.liked ? "currentColor" : "none"} />
            </span>
            <span className="rail-count">{compactNumber(social.likeCount)}</span>
          </button>
          <button type="button" className="rail-btn" onClick={() => setPanel("comments")} aria-label="Comments">
            <span className="rail-icon">
              <MessageCircle size={28} />
            </span>
            <span className="rail-count">{compactNumber(commentCount)}</span>
          </button>
          <button
            type="button"
            className={`rail-btn${social.saved ? " is-saved" : ""}`}
            onClick={() => requireSignIn(() => setPanel("save"))}
            aria-label="Save"
          >
            <span className="rail-icon">
              <Bookmark size={28} fill={social.saved ? "currentColor" : "none"} />
            </span>
            <span className="rail-count">{compactNumber(social.saveCount)}</span>
          </button>
          <button type="button" className="rail-btn" onClick={() => setPanel("share")} aria-label="Share">
            <span className="rail-icon">
              <Share2 size={28} />
            </span>
            <span className="rail-count">Share</span>
          </button>
          <button type="button" className="rail-btn" onClick={() => setPanel("more")} aria-label="More options">
            <span className="rail-icon">
              <Ellipsis size={28} />
            </span>
          </button>
        </div>
      </div>

      <Modal open={panel === "comments"} onClose={() => setPanel(null)} title={`${compactNumber(commentCount)} comments`} variant="sheet">
        <CommentsPanel video={video} onCountChange={(d) => setCommentCount((c) => c + d)} />
      </Modal>
      <ShareDialog video={video} open={panel === "share"} onClose={() => setPanel(null)} />
      {panel === "save" && (
        <SaveDialog video={video} saved={social.saved} onToggleSave={social.toggleSave} open onClose={() => setPanel(null)} />
      )}
      <Modal open={panel === "more"} onClose={() => setPanel(null)} title="Options" variant="sheet">
        <div className="menu-list">
          <button type="button" className="menu-item" onClick={() => navigate(`/v/${video.id}`)}>
            <ExternalLink size={18} /> Open video page
          </button>
          {!isMine && (
            <button type="button" className="menu-item danger" onClick={() => requireSignIn(() => setPanel("report"))}>
              <Flag size={18} /> Report video
            </button>
          )}
        </div>
      </Modal>
      <ReportDialog open={panel === "report"} onClose={() => setPanel(null)} target={{ videoId: video.id, label: "video" }} />
    </section>
  );
}

/**
 * Vertical, snap-scrolling feed. Only the visible video plays; the next and previous ones are
 * attached (with a small buffer) so swiping feels instant, and everything else stays detached.
 */
export function VideoFeed({
  videos,
  viewer,
  setViewer,
  hasMore,
  loadMore,
}: {
  videos: VideoCard[];
  viewer: ViewerState;
  setViewer: (update: (v: ViewerState) => ViewerState) => void;
  hasMore: boolean;
  loadMore: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(() => sessionStorageGet("muted") !== "false");

  const updateMuted = useCallback((m: boolean) => {
    setMuted(m);
    sessionStorageSet("muted", String(m));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            setActiveIndex(Number((entry.target as HTMLElement).dataset.index));
          }
        }
      },
      { root: container, threshold: [0.6] },
    );
    container.querySelectorAll(".feed-item[data-index]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [videos.length]);

  useEffect(() => {
    if (hasMore && activeIndex >= videos.length - 3) loadMore();
  }, [activeIndex, videos.length, hasMore, loadMore]);

  const scrollTo = useCallback((index: number) => {
    const container = containerRef.current;
    const target = container?.querySelector<HTMLElement>(`.feed-item[data-index="${index}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Keyboard: arrows / j k to move, space to play/pause, m to mute.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        scrollTo(Math.min(activeIndex + 1, videos.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        scrollTo(Math.max(activeIndex - 1, 0));
      } else if (e.key === "m") {
        updateMuted(!muted);
      } else if (e.key === " ") {
        e.preventDefault();
        containerRef.current?.querySelector<HTMLButtonElement>(`.feed-item[data-index="${activeIndex}"] .player-tap`)?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, videos.length, muted, scrollTo, updateMuted]);

  const onFollowChange = useCallback(
    (userId: string, follow: boolean) =>
      setViewer((v) => {
        const following = new Set(v.following);
        if (follow) following.add(userId);
        else following.delete(userId);
        return { ...v, following };
      }),
    [setViewer],
  );

  return (
    <div className="feed" ref={containerRef}>
      {videos.map((video, i) => (
        <FeedItem
          key={video.id}
          video={video}
          index={i}
          active={i === activeIndex}
          load={Math.abs(i - activeIndex) <= 1}
          muted={muted}
          setMuted={updateMuted}
          viewer={viewer}
          onFollowChange={onFollowChange}
        />
      ))}
      {hasMore && (
        <div className="feed-item feed-loading" aria-hidden>
          <span className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      )}
    </div>
  );
}

function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionStorageSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the setting just won't persist.
  }
}
