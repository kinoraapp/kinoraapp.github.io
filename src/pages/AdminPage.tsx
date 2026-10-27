import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Ban,
  CheckCircle2,
  Clapperboard,
  Database,
  Eye,
  EyeOff,
  Film,
  Flag,
  Globe,
  HardDrive,
  KeyRound,
  Link2,
  Lock,
  MessageCircle,
  Search,
  Shield,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Brand";
import { DailyBarChart, StatCard } from "../components/Charts";
import { EmptyState, ErrorState, Spinner } from "../components/Feedback";
import { ConfirmDialog, Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { AccessManager } from "../components/VideoForm";
import { StatusBadges, VisibilityBadge } from "../components/VideoGrid";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useBrowser";
import { usePosters } from "../hooks/usePlayback";
import {
  adminDeleteComment,
  adminListComments,
  adminListReports,
  adminListUsers,
  adminListVideos,
  adminResolveReport,
  adminReviewCreator,
  adminSetRole,
  adminSetSuspension,
  adminSetUploadPermission,
  adminSetVideoModeration,
  adminStats,
  deleteVideo,
  setCommentHidden,
  updateVideo,
} from "../lib/api";
import { bytes, compactNumber, reportReasonLabel, timeAgo, visibilityLabel } from "../lib/format";
import type { AdminReport, AdminUser, ReportStatus, Role, VideoCard, Visibility } from "../lib/types";

const TABS = [
  { key: "overview", label: "Overview", icon: Database },
  { key: "users", label: "Users", icon: Users },
  { key: "creators", label: "Creators", icon: Clapperboard },
  { key: "videos", label: "Videos", icon: Film },
  { key: "reports", label: "Reports", icon: Flag },
  { key: "comments", label: "Comments", icon: MessageCircle },
  { key: "access", label: "Access", icon: KeyRound },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function Overview() {
  const stats = useAsync(() => adminStats(), []);
  const recent = useAsync(() => adminListVideos("", "all"), []);
  const posters = usePosters((recent.data ?? []).slice(0, 8).map((v) => v.id));
  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />;
  const s = stats.data;
  if (!s) return <Spinner />;
  return (
    <>
      <div className="stat-grid">
        <StatCard icon={<Users size={16} />} label="Users" value={compactNumber(s.users)} hint={`${s.creators} creators · ${s.admins} admins · ${s.suspended} suspended`} />
        <StatCard icon={<Film size={16} />} label="Videos" value={compactNumber(s.videos)} hint={`${s.live_videos} live · ${s.draft_videos} drafts · ${s.scheduled_videos} scheduled`} />
        <StatCard icon={<Eye size={16} />} label="Total views" value={compactNumber(s.views)} hint={`${compactNumber(s.likes)} likes · ${compactNumber(s.comments)} comments`} />
        <StatCard icon={<Globe size={16} />} label="Public videos" value={s.public_videos} />
        <StatCard icon={<Lock size={16} />} label="Private videos" value={s.private_videos} hint={`${s.unlisted_videos} unlisted · ${s.selected_videos} selected users`} />
        <StatCard icon={<Flag size={16} />} label="Open reports" value={s.open_reports} hint={`${plural(s.removed_videos, "video")} removed`} />
        <StatCard icon={<Clapperboard size={16} />} label="Creator requests" value={s.pending_creators} />
        <StatCard
          icon={<HardDrive size={16} />}
          label="Storage"
          value={bytes(s.storage.video_bytes)}
          hint={`${Math.round(s.storage.video_seconds / 60).toLocaleString()} video minutes · ${bytes(s.storage.thumbnail_bytes + s.storage.avatar_bytes)} images`}
        />
      </div>
      {(s.processing_videos > 0 || s.failed_videos > 0) && (
        <p className="notice">
          {plural(s.processing_videos, "video")} processing or waiting for upload, {s.failed_videos} failed.
        </p>
      )}
      <div className="dash-row">
        <div className="card">
          <DailyBarChart points={s.views_by_day} field="views" label="Views, last 14 days" />
        </div>
        <div className="card">
          <DailyBarChart points={s.signups_by_day} field="users" label="Sign-ups, last 14 days" />
        </div>
      </div>
      <div className="card">
        <h2 className="card-title">Recent uploads</h2>
        {(recent.data ?? []).length === 0 ? (
          <p className="muted">No uploads yet.</p>
        ) : (
          <ul className="manage-list compact">
            {recent.data!.slice(0, 8).map((v) => (
              <li key={v.id} className="manage-row">
                <Link to={`/v/${v.id}`} className="manage-thumb">
                  {posters[v.id] ? <img src={posters[v.id]!} alt="" /> : <Film size={20} />}
                </Link>
                <div className="manage-main">
                  <Link to={`/v/${v.id}`} className="manage-title">
                    {v.title}
                  </Link>
                  <span className="muted small">
                    @{v.username} · {timeAgo(v.created_at)}
                  </span>
                  <div className="badge-row">
                    <VisibilityBadge visibility={v.visibility} />
                    <StatusBadges video={v} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function UsersTab({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(pendingOnly ? "pending" : "all");
  const debounced = useDebounced(query, 300);
  const users = useAsync(() => adminListUsers(debounced, pendingOnly ? "pending" : filter), [debounced, filter, pendingOnly]);
  const [suspending, setSuspending] = useState<AdminUser | null>(null);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
      users.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <div className="toolbar">
        <label className="search-bar small">
          <Search size={16} aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, username or email" aria-label="Search users" />
        </label>
        {!pendingOnly && (
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter users">
            <option value="all">All users</option>
            <option value="viewers">Viewers</option>
            <option value="creators">Creators</option>
            <option value="admins">Administrators</option>
            <option value="pending">Creator requests</option>
            <option value="suspended">Suspended</option>
          </select>
        )}
      </div>
      {users.loading ? (
        <Spinner />
      ) : users.error ? (
        <ErrorState error={users.error} onRetry={users.reload} />
      ) : (users.data ?? []).length === 0 ? (
        <EmptyState icon={<Users size={32} />} title={pendingOnly ? "No pending creator requests" : "No users found"} />
      ) : (
        <ul className="admin-list">
          {users.data!.map((u) => (
            <li key={u.id} className="admin-row">
              <Link to={`/u/${u.username}`} className="admin-user">
                <Avatar src={u.avatar_url} name={u.username} size={40} />
                <span>
                  <strong>{u.display_name || u.username}</strong>
                  <span className="muted small">
                    @{u.username} · {u.email}
                  </span>
                  <span className="muted small">
                    Joined {timeAgo(u.created_at)} · {u.video_count} videos · {compactNumber(u.follower_count)} followers
                  </span>
                </span>
              </Link>
              <div className="badge-row">
                {u.is_suspended && <span className="badge badge-danger">Suspended</span>}
                {u.creator_status === "pending" && <span className="badge badge-warning">Wants to create</span>}
                {u.role === "creator" && !u.can_upload && <span className="badge">Uploads paused</span>}
              </div>
              {u.creator_status === "pending" && u.creator_request_note && <p className="request-note">“{u.creator_request_note}”</p>}
              <div className="admin-actions">
                {u.creator_status === "pending" && (
                  <>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => run(() => adminReviewCreator(u.id, true), `@${u.username} is now a creator`)}>
                      <CheckCircle2 size={14} /> Approve
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(() => adminReviewCreator(u.id, false), "Request declined")}>
                      <XCircle size={14} /> Decline
                    </button>
                  </>
                )}
                {!pendingOnly && (
                  <>
                    <select
                      className="input input-sm"
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={(e) => run(() => adminSetRole(u.id, e.target.value as Role), `Role changed to ${e.target.value}`)}
                      aria-label={`Role for @${u.username}`}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="creator">Creator</option>
                      <option value="admin">Administrator</option>
                    </select>
                    {u.role === "creator" && (
                      <label className="check-row small">
                        <input
                          type="checkbox"
                          checked={u.can_upload}
                          onChange={(e) =>
                            run(() => adminSetUploadPermission(u.id, e.target.checked), e.target.checked ? "Uploads allowed" : "Uploads paused")
                          }
                        />
                        Can upload
                      </label>
                    )}
                    {u.id !== me?.id &&
                      (u.is_suspended ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(() => adminSetSuspension(u.id, false), "Account reinstated")}>
                          Reinstate
                        </button>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setSuspending(u)}>
                          <Ban size={14} /> Suspend
                        </button>
                      ))}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!suspending}
        title={`Suspend @${suspending?.username}?`}
        message="They can't sign in, post, comment or like, and their videos are hidden until you reinstate them."
        reasonLabel="Reason (shown to the user)"
        confirmLabel="Suspend account"
        danger
        onClose={() => setSuspending(null)}
        onConfirm={async (reason) => {
          const res = await adminSetSuspension(suspending!.id, true, reason).catch((e) => {
            toast.error(e);
            return null;
          });
          if (res) {
            toast.success(res.warning ?? "Account suspended");
            users.reload();
          }
        }}
      />
    </>
  );
}

function VideosTab({ onManageAccess }: { onManageAccess: (v: VideoCard) => void }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const debounced = useDebounced(query, 300);
  const videos = useAsync(() => adminListVideos(debounced, filter), [debounced, filter]);
  const posters = usePosters((videos.data ?? []).slice(0, 60).map((v) => v.id));
  const [moderating, setModerating] = useState<VideoCard | null>(null);
  const [deleting, setDeleting] = useState<VideoCard | null>(null);

  return (
    <>
      <div className="toolbar">
        <label className="search-bar small">
          <Search size={16} aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, caption or @creator" aria-label="Search videos" />
        </label>
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter videos">
          <option value="all">All videos</option>
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
          <option value="selected">Selected users</option>
          <option value="draft">Drafts</option>
          <option value="scheduled">Scheduled</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
          <option value="removed">Removed</option>
        </select>
      </div>
      {videos.loading ? (
        <Spinner />
      ) : videos.error ? (
        <ErrorState error={videos.error} onRetry={videos.reload} />
      ) : (videos.data ?? []).length === 0 ? (
        <EmptyState icon={<Film size={32} />} title="No videos found" />
      ) : (
        <ul className="manage-list">
          {videos.data!.map((v) => (
            <li key={v.id} className="manage-row">
              <Link to={`/v/${v.id}`} className="manage-thumb">
                {posters[v.id] ? <img src={posters[v.id]!} alt="" loading="lazy" /> : <Film size={20} />}
              </Link>
              <div className="manage-main">
                <Link to={`/v/${v.id}`} className="manage-title">
                  {v.title}
                </Link>
                <span className="muted small">
                  <Link to={`/u/${v.username}`}>@{v.username}</Link> · {timeAgo(v.created_at)} · {compactNumber(v.view_count)} views
                </span>
                <div className="badge-row">
                  <VisibilityBadge visibility={v.visibility} />
                  <StatusBadges video={v} />
                </div>
              </div>
              <div className="manage-actions">
                <select
                  className="input input-sm"
                  value={v.visibility}
                  aria-label="Visibility"
                  onChange={(e) =>
                    updateVideo(v.id, { visibility: e.target.value as Visibility })
                      .then(() => {
                        toast.success(`Now ${visibilityLabel[e.target.value]}`);
                        videos.reload();
                      })
                      .catch(toast.error)
                  }
                >
                  {Object.entries(visibilityLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onManageAccess(v)}>
                  <KeyRound size={14} /> Access
                </button>
                <Link to={`/studio/videos/${v.id}`} className="btn btn-ghost btn-sm">
                  Edit
                </Link>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModerating(v)}>
                  {v.moderation_status === "removed" ? <Eye size={14} /> : <EyeOff size={14} />}
                  {v.moderation_status === "removed" ? "Restore" : "Remove"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setDeleting(v)} aria-label="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!moderating}
        title={moderating?.moderation_status === "removed" ? "Restore video?" : "Remove video?"}
        message={
          moderating?.moderation_status === "removed"
            ? "It becomes visible again according to its visibility setting."
            : "It's hidden from everyone except the owner and administrators. The owner is notified."
        }
        reasonLabel={moderating?.moderation_status === "removed" ? undefined : "Reason shown to the owner"}
        confirmLabel={moderating?.moderation_status === "removed" ? "Restore" : "Remove"}
        danger={moderating?.moderation_status !== "removed"}
        onClose={() => setModerating(null)}
        onConfirm={async (reason) => {
          try {
            await adminSetVideoModeration(moderating!.id, moderating!.moderation_status === "removed" ? "active" : "removed", reason);
            videos.reload();
          } catch (e) {
            toast.error(e);
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete video permanently?"
        message={`“${deleting?.title}” by @${deleting?.username} will be deleted with its file, comments and stats.`}
        confirmLabel="Delete forever"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await deleteVideo(deleting!.id);
            toast.success("Video deleted");
            videos.reload();
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </>
  );
}

function ReportsTab() {
  const toast = useToast();
  const [status, setStatus] = useState<ReportStatus>("open");
  const reports = useAsync(() => adminListReports(status), [status]);
  const [suspending, setSuspending] = useState<AdminReport | null>(null);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
      reports.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <div className="chips">
        {(["open", "resolved", "dismissed"] as ReportStatus[]).map((s) => (
          <button type="button" key={s} className={`chip-btn${status === s ? " active" : ""}`} onClick={() => setStatus(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {reports.loading ? (
        <Spinner />
      ) : reports.error ? (
        <ErrorState error={reports.error} onRetry={reports.reload} />
      ) : (reports.data ?? []).length === 0 ? (
        <EmptyState icon={<Flag size={32} />} title={status === "open" ? "No open reports" : "Nothing here"} />
      ) : (
        <ul className="admin-list">
          {reports.data!.map((r) => (
            <li key={r.id} className="admin-row report">
              <div className="report-head">
                <span className="badge badge-warning">{reportReasonLabel[r.reason]}</span>
                <span className="muted small">
                  Reported by @{r.reporter_username} · {timeAgo(r.created_at)}
                </span>
              </div>
              {r.details && <p className="request-note">“{r.details}”</p>}
              <div className="report-target">
                {r.comment_body ? (
                  <p>
                    Comment{r.comment_hidden ? " (hidden)" : ""}: <q>{r.comment_body}</q>
                  </p>
                ) : null}
                {r.video_id && (
                  <p>
                    Video: <Link to={`/v/${r.video_id}`}>{r.video_title}</Link>
                    {r.video_moderation === "removed" && <span className="badge badge-danger">Removed</span>}
                  </p>
                )}
                {r.reported_username && (
                  <p>
                    Account: <Link to={`/u/${r.reported_username}`}>@{r.reported_username}</Link>
                    {r.reported_suspended && <span className="badge badge-danger">Suspended</span>}
                  </p>
                )}
                {r.resolution_note && <p className="muted small">Note: {r.resolution_note}</p>}
              </div>
              {r.status === "open" ? (
                <div className="admin-actions">
                  {r.comment_id && !r.comment_hidden && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(() => setCommentHidden(r.comment_id!, true, true), "Comment hidden")}>
                      <EyeOff size={14} /> Hide comment
                    </button>
                  )}
                  {r.video_id && r.video_moderation !== "removed" && !r.comment_id && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => act(() => adminSetVideoModeration(r.video_id!, "removed", reportReasonLabel[r.reason]), "Video removed")}
                    >
                      <EyeOff size={14} /> Remove video
                    </button>
                  )}
                  {r.reported_user_id && !r.reported_suspended && (
                    <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setSuspending(r)}>
                      <Ban size={14} /> Suspend account
                    </button>
                  )}
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => act(() => adminResolveReport(r.id, "resolved"), "Marked resolved")}>
                    <CheckCircle2 size={14} /> Resolve
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => adminResolveReport(r.id, "dismissed"), "Report dismissed")}>
                    Dismiss
                  </button>
                </div>
              ) : (
                <div className="admin-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => adminResolveReport(r.id, "open"), "Reopened")}>
                    Reopen
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!suspending}
        title={`Suspend @${suspending?.reported_username}?`}
        message="They can't sign in, post, comment or like, and their videos are hidden until reinstated."
        reasonLabel="Reason (shown to the user)"
        confirmLabel="Suspend"
        danger
        onClose={() => setSuspending(null)}
        onConfirm={async (reason) => {
          try {
            await adminSetSuspension(suspending!.reported_user_id!, true, reason || reportReasonLabel[suspending!.reason]);
            toast.success("Account suspended");
            reports.reload();
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </>
  );
}

function CommentsTab() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const comments = useAsync(() => adminListComments(debounced), [debounced]);
  return (
    <>
      <div className="toolbar">
        <label className="search-bar small">
          <Search size={16} aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search comments" aria-label="Search comments" />
        </label>
      </div>
      {comments.loading ? (
        <Spinner />
      ) : comments.error ? (
        <ErrorState error={comments.error} onRetry={comments.reload} />
      ) : (comments.data ?? []).length === 0 ? (
        <EmptyState icon={<MessageCircle size={32} />} title="No comments" />
      ) : (
        <ul className="admin-list">
          {comments.data!.map((c) => (
            <li key={c.id} className={`admin-row${c.is_hidden ? " is-hidden" : ""}`}>
              <p>
                <strong>@{c.author?.username ?? "unknown"}</strong> on <Link to={`/v/${c.video_id}`}>{c.video?.title ?? "a video"}</Link>{" "}
                <span className="muted small">{timeAgo(c.created_at)}</span>
                {c.is_hidden && <span className="badge">Hidden</span>}
              </p>
              <p className="request-note">{c.body}</p>
              <div className="admin-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setCommentHidden(c.id, !c.is_hidden, true).then(comments.reload).catch(toast.error)}
                >
                  {c.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />} {c.is_hidden ? "Unhide" : "Hide"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => adminDeleteComment(c.id).then(comments.reload).catch(toast.error)}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AccessTab({ initial }: { initial: VideoCard | null }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const [picked, setPicked] = useState<VideoCard | null>(initial);
  const videos = useAsync(() => (debounced ? adminListVideos(debounced, "all") : adminListVideos("", "selected")), [debounced]);
  return (
    <div className="access-tab">
      <div className="card">
        <h2 className="card-title">Choose a video</h2>
        <label className="search-bar small">
          <Search size={16} aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search any video" aria-label="Search videos" />
        </label>
        {!debounced && <p className="muted small">Showing “Selected users” videos. Search to find any video.</p>}
        {videos.loading ? (
          <Spinner />
        ) : (
          <ul className="pick-list">
            {(videos.data ?? []).map((v) => (
              <li key={v.id}>
                <button type="button" className={`pick-item${picked?.id === v.id ? " selected" : ""}`} onClick={() => setPicked(v)}>
                  <span className="truncate">{v.title}</span>
                  <span className="muted small">
                    @{v.username} · {visibilityLabel[v.visibility]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        {picked ? (
          <>
            <h2 className="card-title">{picked.title}</h2>
            <p className="muted small">
              @{picked.username} · <VisibilityBadge visibility={picked.visibility} />
            </p>
            <AccessManager key={picked.id} videoId={picked.id} visibility={picked.visibility} ownerId={picked.owner_id} />
          </>
        ) : (
          <EmptyState icon={<Link2 size={32} />} title="Pick a video to manage who can watch it" />
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "overview") as TabKey;
  const [accessVideo, setAccessVideo] = useState<VideoCard | null>(null);
  const setTab = (key: TabKey) => setParams({ tab: key }, { replace: true });

  return (
    <div className="page page-wide">
      <header className="page-header">
        <h1 className="page-title">
          <Shield size={24} /> Admin
        </h1>
      </header>
      <div className="tabs scroll" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "users" && <UsersTab />}
      {tab === "creators" && <UsersTab pendingOnly />}
      {tab === "videos" && <VideosTab onManageAccess={setAccessVideo} />}
      {tab === "reports" && <ReportsTab />}
      {tab === "comments" && <CommentsTab />}
      {tab === "access" && <AccessTab initial={null} />}
      <Modal open={!!accessVideo} onClose={() => setAccessVideo(null)} title={`Access: ${accessVideo?.title ?? ""}`} wide>
        {accessVideo && <AccessManager videoId={accessVideo.id} visibility={accessVideo.visibility} ownerId={accessVideo.owner_id} />}
      </Modal>
    </div>
  );
}
