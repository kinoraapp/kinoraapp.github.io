import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Clapperboard, Flag, Link as LinkIcon, ListVideo, Settings, UserCheck, UserPlus, UserX, Video } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Brand";
import { EmptyState, ErrorState, PageLoader, Spinner } from "../components/Feedback";
import { useToast } from "../components/Toast";
import { ReportDialog, useRequireSignIn } from "../components/VideoActions";
import { VideoGrid } from "../components/VideoGrid";
import { useAsync } from "../hooks/useAsync";
import { getFollowingIds, getProfileByUsername, listCreatorVideos, listPublicPlaylists, setFollowing } from "../lib/api";
import { compactNumber } from "../lib/format";

export default function ProfilePage() {
  const { username = "" } = useParams();
  const { user, canUpload } = useAuth();
  const toast = useToast();
  const requireSignIn = useRequireSignIn();
  const [tab, setTab] = useState<"videos" | "playlists">("videos");
  const [reporting, setReporting] = useState(false);
  const profile = useAsync(() => getProfileByUsername(username), [username, user?.id]);
  const p = profile.data;
  const videos = useAsync(() => (p ? listCreatorVideos(p.id) : Promise.resolve([])), [p?.id]);
  const playlists = useAsync(() => (p && tab === "playlists" ? listPublicPlaylists(p.id) : Promise.resolve([])), [p?.id, tab]);
  const followingIds = useAsync(() => getFollowingIds(), [user?.id]);
  const [following, setFollowingState] = useState(false);
  const [followers, setFollowers] = useState(0);
  const isMe = !!p && user?.id === p.id;

  useEffect(() => {
    if (p) {
      setFollowingState((followingIds.data ?? []).includes(p.id));
      setFollowers(p.follower_count);
    }
  }, [p, followingIds.data]);

  if (profile.loading) return <PageLoader />;
  if (profile.error) return <ErrorState error={profile.error} onRetry={profile.reload} />;
  if (!p) {
    return (
      <div className="page page-narrow">
        <EmptyState icon={<UserX size={40} />} title="Account not found">
          @{username} doesn't exist or is no longer available.
        </EmptyState>
      </div>
    );
  }

  const toggleFollow = () =>
    requireSignIn(async () => {
      const next = !following;
      setFollowingState(next);
      setFollowers((n) => n + (next ? 1 : -1));
      try {
        await setFollowing(p.id, next);
      } catch (e) {
        setFollowingState(!next);
        setFollowers((n) => n + (next ? -1 : 1));
        toast.error(e);
      }
    });

  const totalLikes = (videos.data ?? []).reduce((sum, v) => sum + v.like_count, 0);

  return (
    <div className="page">
      <header className="profile-header">
        <Avatar src={p.avatar_url} name={p.username} size={96} />
        <div className="profile-info">
          <h1>{p.display_name || p.username}</h1>
          <p className="muted">
            @{p.username}
            {p.role === "creator" && <span className="badge badge-brand">Creator</span>}
            {p.role === "admin" && <span className="badge badge-brand">Admin</span>}
          </p>
          <ul className="profile-counts">
            <li>
              <strong>{compactNumber(p.following_count)}</strong> Following
            </li>
            <li>
              <strong>{compactNumber(followers)}</strong> Followers
            </li>
            <li>
              <strong>{compactNumber(totalLikes)}</strong> Likes
            </li>
          </ul>
          {p.bio && <p className="profile-bio">{p.bio}</p>}
          {p.website && (
            <a href={p.website} target="_blank" rel="noopener noreferrer nofollow ugc" className="profile-link">
              <LinkIcon size={14} /> {p.website.replace(/^https?:\/\//, "")}
            </a>
          )}
          <div className="profile-actions">
            {isMe ? (
              <>
                <Link to="/settings" className="btn btn-secondary">
                  <Settings size={16} /> Edit profile
                </Link>
                {canUpload && (
                  <Link to="/studio" className="btn btn-secondary">
                    <Clapperboard size={16} /> Creator studio
                  </Link>
                )}
              </>
            ) : (
              <>
                <button type="button" className={`btn ${following ? "btn-secondary" : "btn-primary"}`} onClick={toggleFollow}>
                  {following ? <UserCheck size={16} /> : <UserPlus size={16} />} {following ? "Following" : "Follow"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => requireSignIn(() => setReporting(true))} aria-label="Report account">
                  <Flag size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "videos"} className={`tab${tab === "videos" ? " active" : ""}`} onClick={() => setTab("videos")}>
          <Video size={16} /> Videos
        </button>
        <button type="button" role="tab" aria-selected={tab === "playlists"} className={`tab${tab === "playlists" ? " active" : ""}`} onClick={() => setTab("playlists")}>
          <ListVideo size={16} /> Playlists
        </button>
      </div>

      {tab === "videos" ? (
        videos.loading ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : videos.error ? (
          <ErrorState error={videos.error} onRetry={videos.reload} />
        ) : (videos.data ?? []).length === 0 ? (
          <EmptyState icon={<Video size={36} />} title="No public videos yet">
            {isMe ? "Videos you publish publicly show up here. Drafts and private videos are in your studio." : undefined}
          </EmptyState>
        ) : (
          <VideoGrid videos={videos.data!} />
        )
      ) : playlists.loading ? (
        <div className="center-pad">
          <Spinner />
        </div>
      ) : (playlists.data ?? []).length === 0 ? (
        <EmptyState icon={<ListVideo size={36} />} title="No public playlists" />
      ) : (
        <ul className="playlist-list">
          {playlists.data!.map((pl) => (
            <li key={pl.id}>
              <Link to={`/library/playlists/${pl.id}`} className="playlist-card">
                <ListVideo size={22} />
                <span>
                  <strong>{pl.title}</strong>
                  <span className="muted small">{pl.video_count} videos</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ReportDialog open={reporting} onClose={() => setReporting(false)} target={{ userId: p.id, label: `@${p.username}` }} />
    </div>
  );
}
