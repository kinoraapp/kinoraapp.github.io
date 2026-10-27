import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bookmark, Eye, Flag, Heart, Lock, Pencil, Share2, UserCheck, UserPlus } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Brand";
import { CommentsPanel } from "../components/Comments";
import { Caption } from "../components/Feed";
import { EmptyState, ErrorState, PageLoader } from "../components/Feedback";
import { useToast } from "../components/Toast";
import { ReportDialog, SaveDialog, ShareDialog, useRequireSignIn, useVideoSocial } from "../components/VideoActions";
import { StatusBadges, VisibilityBadge } from "../components/VideoGrid";
import { VideoPlayer } from "../components/VideoPlayer";
import { useAsync } from "../hooks/useAsync";
import { getFollowingIds, getVideo, getViewerState, recordView, redeemShareLink, setFollowing } from "../lib/api";
import { invalidatePlayback } from "../lib/playback";
import { compactNumber, dateTime, timeAgo } from "../lib/format";
import type { VideoCard } from "../lib/types";

function VideoDetails({ video, shareKey }: { video: VideoCard; shareKey: string | null }) {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const requireSignIn = useRequireSignIn();
  const state = useAsync(
    async () => {
      const [viewer, following] = await Promise.all([getViewerState([video.id]), getFollowingIds()]);
      return { liked: viewer.liked.has(video.id), saved: viewer.saved.has(video.id), following: following.includes(video.owner_id) };
    },
    [video.id, user?.id],
  );
  const social = useVideoSocial(video, { liked: !!state.data?.liked, saved: !!state.data?.saved });
  const [following, setFollowingState] = useState(false);
  const [muted, setMuted] = useState(false);
  const [panel, setPanel] = useState<"share" | "save" | "report" | null>(null);
  const [commentCount, setCommentCount] = useState(video.comment_count);
  const isOwner = user?.id === video.owner_id;

  useEffect(() => setFollowingState(!!state.data?.following), [state.data?.following]);

  const toggleFollow = () =>
    requireSignIn(async () => {
      const next = !following;
      setFollowingState(next);
      try {
        await setFollowing(video.owner_id, next);
      } catch (e) {
        setFollowingState(!next);
        toast.error(e);
      }
    });

  return (
    <div className="video-page">
      <div className="video-page-player">
        <button type="button" className="icon-btn icon-btn-glass back-btn" onClick={() => (history.length > 1 ? navigate(-1) : navigate("/"))} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <VideoPlayer
          videoId={video.id}
          shareKey={shareKey}
          active
          load
          muted={muted}
          onMutedChange={setMuted}
          fit="contain"
          onDoubleTap={() => social.toggleLike(true)}
          onWatched={() => recordView(video.id, shareKey).catch(() => undefined)}
        />
      </div>

      <aside className="video-page-side">
        <div className="creator-row">
          <Link to={`/u/${video.username}`} className="creator-link">
            <Avatar src={video.avatar_url} name={video.username} size={44} />
            <span>
              <strong>{video.display_name || video.username}</strong>
              <span className="muted small">
                @{video.username} · {timeAgo(video.live_at ?? video.created_at)}
              </span>
            </span>
          </Link>
          {isOwner ? (
            <Link to={`/studio/videos/${video.id}`} className="btn btn-secondary btn-sm">
              <Pencil size={14} /> Edit
            </Link>
          ) : (
            <button type="button" className={`btn btn-sm ${following ? "btn-secondary" : "btn-primary"}`} onClick={toggleFollow}>
              {following ? <UserCheck size={14} /> : <UserPlus size={14} />} {following ? "Following" : "Follow"}
            </button>
          )}
        </div>

        <h1 className="video-title">{video.title}</h1>
        {(isOwner || isAdmin) && (
          <div className="badge-row">
            <VisibilityBadge visibility={video.visibility} />
            <StatusBadges video={video} />
            {isAdmin && !isOwner && (
              <Link to={`/studio/videos/${video.id}`} className="badge badge-brand">
                <Pencil size={12} /> Manage as admin
              </Link>
            )}
          </div>
        )}
        {video.moderation_status === "removed" && (
          <p className="notice notice-danger">
            Removed by moderators{video.moderation_reason ? `: ${video.moderation_reason}` : ""}. Only you and administrators can see it.
          </p>
        )}
        {video.status === "scheduled" && !video.is_live && (
          <p className="notice">Scheduled to publish {dateTime(video.publish_at)}.</p>
        )}
        <Caption text={video.caption} clamp={false} />
        <p className="muted small video-stats">
          <Eye size={14} /> {compactNumber(video.view_count)} views
        </p>

        <div className="action-bar">
          <button type="button" className={`action-btn${social.liked ? " is-liked" : ""}`} onClick={() => social.toggleLike()} aria-pressed={social.liked}>
            <Heart size={20} fill={social.liked ? "currentColor" : "none"} /> {compactNumber(social.likeCount)}
          </button>
          <button type="button" className={`action-btn${social.saved ? " is-saved" : ""}`} onClick={() => requireSignIn(() => setPanel("save"))}>
            <Bookmark size={20} fill={social.saved ? "currentColor" : "none"} /> {compactNumber(social.saveCount)}
          </button>
          <button type="button" className="action-btn" onClick={() => setPanel("share")}>
            <Share2 size={20} /> Share
          </button>
          {!isOwner && (
            <button type="button" className="action-btn" onClick={() => requireSignIn(() => setPanel("report"))}>
              <Flag size={20} /> Report
            </button>
          )}
        </div>

        <h2 className="section-label">{compactNumber(commentCount)} comments</h2>
        <CommentsPanel video={video} shareKey={shareKey} onCountChange={(d) => setCommentCount((c) => c + d)} />
      </aside>

      <ShareDialog video={video} shareKey={shareKey} open={panel === "share"} onClose={() => setPanel(null)} />
      {panel === "save" && <SaveDialog video={video} saved={social.saved} onToggleSave={social.toggleSave} open onClose={() => setPanel(null)} />}
      <ReportDialog open={panel === "report"} onClose={() => setPanel(null)} target={{ videoId: video.id, label: "video" }} />
    </div>
  );
}

export default function VideoPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const shareKey = params.get("k");
  const { user, loading: authLoading } = useAuth();
  const video = useAsync(
    async () => {
      if (authLoading) return undefined;
      // A signed-in visitor with a valid unlisted link keeps access (so they can like, comment and save).
      if (user && shareKey) await redeemShareLink(id, shareKey).catch(() => undefined);
      invalidatePlayback(id);
      return getVideo(id, shareKey);
    },
    [id, shareKey, user?.id, authLoading],
  );

  if (authLoading || video.loading || video.data === undefined) {
    if (video.error) return <ErrorState error={video.error} onRetry={video.reload} />;
    return <PageLoader />;
  }
  if (video.error) return <ErrorState error={video.error} onRetry={video.reload} />;
  if (!video.data) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<Lock size={40} />}
          title="Video unavailable"
          action={
            user ? (
              <Link to="/" className="btn btn-secondary">
                Back to the feed
              </Link>
            ) : (
              <Link to={`/login?next=${encodeURIComponent(`/v/${id}${shareKey ? `?k=${shareKey}` : ""}`)}`} className="btn btn-primary">
                Log in to watch
              </Link>
            )
          }
        >
          This video is private, was removed, or the link is incomplete.
          {user ? "" : " If someone gave you access, log in first."}
        </EmptyState>
      </div>
    );
  }
  return <VideoDetails video={video.data} shareKey={shareKey} />;
}
