import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Eye, Film, Heart, MessageCircle, Pencil, Share2, SquarePlus, Trash2, Users } from "lucide-react";
import { DailyBarChart, StatCard } from "../components/Charts";
import { EmptyState, ErrorState, PageLoader, Spinner } from "../components/Feedback";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import { ShareDialog } from "../components/VideoActions";
import { StatusBadges, VisibilityBadge } from "../components/VideoGrid";
import { useAsync } from "../hooks/useAsync";
import { usePosters } from "../hooks/usePlayback";
import { creatorStats, deleteVideo, listMyVideos, updateVideo } from "../lib/api";
import { compactNumber, dateTime, duration, timeAgo } from "../lib/format";
import type { VideoCard } from "../lib/types";

const FILTERS = {
  all: { label: "All", test: () => true },
  live: { label: "Live", test: (v: VideoCard) => v.is_live && v.moderation_status === "active" },
  scheduled: { label: "Scheduled", test: (v: VideoCard) => v.status === "scheduled" && !v.is_live },
  drafts: { label: "Drafts", test: (v: VideoCard) => v.status === "draft" },
  processing: { label: "Processing", test: (v: VideoCard) => v.processing_status !== "ready" },
  removed: { label: "Removed", test: (v: VideoCard) => v.moderation_status === "removed" },
} satisfies Record<string, { label: string; test: (v: VideoCard) => boolean }>;
type FilterKey = keyof typeof FILTERS;

export default function StudioPage() {
  const toast = useToast();
  const stats = useAsync(() => creatorStats(), []);
  const videos = useAsync(() => listMyVideos(), []);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sharing, setSharing] = useState<VideoCard | null>(null);
  const [deleting, setDeleting] = useState<VideoCard | null>(null);
  const shown = useMemo(() => (videos.data ?? []).filter(FILTERS[filter].test), [videos.data, filter]);
  const posters = usePosters(shown.slice(0, 60).map((v) => v.id));

  const togglePublished = async (v: VideoCard) => {
    const publish = v.status === "draft";
    try {
      await updateVideo(v.id, { status: publish ? "published" : "draft", publish_at: null });
      toast.success(publish ? "Published" : "Unpublished: now a draft");
      videos.reload();
      stats.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  if (videos.loading && !videos.data) return <PageLoader />;
  const s = stats.data;

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Creator studio</h1>
        <Link to="/upload" className="btn btn-primary">
          <SquarePlus size={18} /> Upload
        </Link>
      </header>

      {stats.error ? (
        <ErrorState error={stats.error} onRetry={stats.reload} />
      ) : !s ? (
        <div className="center-pad">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard icon={<Eye size={16} />} label="Views" value={compactNumber(s.views)} />
            <StatCard icon={<Heart size={16} />} label="Likes" value={compactNumber(s.likes)} />
            <StatCard icon={<MessageCircle size={16} />} label="Comments" value={compactNumber(s.comments)} />
            <StatCard icon={<Bookmark size={16} />} label="Saves" value={compactNumber(s.saves)} />
            <StatCard icon={<Share2 size={16} />} label="Shares" value={compactNumber(s.shares)} />
            <StatCard icon={<Users size={16} />} label="Followers" value={compactNumber(s.followers)} />
            <StatCard
              icon={<Film size={16} />}
              label="Videos"
              value={s.videos}
              hint={`${s.published} live · ${s.scheduled} scheduled · ${s.drafts} drafts`}
            />
          </div>
          <div className="dash-row">
            <div className="card">
              <DailyBarChart points={s.views_by_day} field="views" label="Views, last 14 days" />
            </div>
            <div className="card">
              <h2 className="card-title">Top videos</h2>
              {s.top_videos.length === 0 ? (
                <p className="muted">No videos yet.</p>
              ) : (
                <ol className="rank-list">
                  {s.top_videos.map((t) => (
                    <li key={t.id}>
                      <Link to={`/v/${t.id}`} className="truncate">
                        {t.title}
                      </Link>
                      <span className="muted small">
                        {compactNumber(t.view_count)} views · {compactNumber(t.like_count)} likes
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Your videos</h2>
          <div className="chips">
            {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
              <button type="button" key={k} className={`chip-btn${filter === k ? " active" : ""}`} onClick={() => setFilter(k)}>
                {FILTERS[k].label} <span className="muted small">{(videos.data ?? []).filter(FILTERS[k].test).length}</span>
              </button>
            ))}
          </div>
        </div>
        {videos.error ? (
          <ErrorState error={videos.error} onRetry={videos.reload} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Film size={36} />}
            title={filter === "all" ? "You haven't uploaded anything yet" : "Nothing here"}
            action={
              filter === "all" ? (
                <Link to="/upload" className="btn btn-primary">
                  Upload a video
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="manage-list">
            {shown.map((v) => (
              <li key={v.id} className="manage-row">
                <Link to={`/studio/videos/${v.id}`} className="manage-thumb" aria-label={`Edit ${v.title}`}>
                  {posters[v.id] ? <img src={posters[v.id]!} alt="" loading="lazy" /> : <Film size={22} />}
                  {v.duration_seconds ? <span className="manage-duration">{duration(v.duration_seconds)}</span> : null}
                </Link>
                <div className="manage-main">
                  <Link to={`/studio/videos/${v.id}`} className="manage-title">
                    {v.title}
                  </Link>
                  <div className="badge-row">
                    <VisibilityBadge visibility={v.visibility} />
                    <StatusBadges video={v} />
                  </div>
                  <span className="muted small">
                    {v.status === "scheduled" && !v.is_live
                      ? `Publishes ${dateTime(v.publish_at)}`
                      : v.live_at
                        ? `Published ${timeAgo(v.live_at)}`
                        : `Created ${timeAgo(v.created_at)}`}
                    {" · "}
                    {compactNumber(v.view_count)} views · {compactNumber(v.like_count)} likes · {compactNumber(v.comment_count)} comments
                  </span>
                </div>
                <div className="manage-actions">
                  <Link to={`/studio/videos/${v.id}`} className="btn btn-secondary btn-sm">
                    <Pencil size={14} /> Edit
                  </Link>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSharing(v)}>
                    <Share2 size={14} /> Link
                  </button>
                  {v.status !== "scheduled" && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => togglePublished(v)}>
                      {v.status === "draft" ? "Publish" : "Unpublish"}
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setDeleting(v)} aria-label={`Delete ${v.title}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sharing && <ShareDialog video={sharing} open onClose={() => setSharing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete this video?"
        message={
          <>
            “{deleting?.title}” and its likes, comments and stats will be permanently deleted. This can't be undone.
          </>
        }
        confirmLabel="Delete forever"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await deleteVideo(deleting!.id);
            toast.success("Video deleted");
            videos.reload();
            stats.reload();
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </div>
  );
}
