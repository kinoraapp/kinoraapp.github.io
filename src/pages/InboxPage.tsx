import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  AtSign,
  Bell,
  CheckCheck,
  CircleAlert,
  Clapperboard,
  Heart,
  KeyRound,
  MessageCircle,
  ShieldCheck,
  Trash2,
  UserPlus,
  Video,
} from "lucide-react";
import { Avatar } from "../components/Brand";
import { EmptyState, ErrorState, PageLoader } from "../components/Feedback";
import { useToast } from "../components/Toast";
import { useAsync } from "../hooks/useAsync";
import { deleteNotification, listNotifications, markNotificationsRead } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { NotificationRow } from "../lib/types";

function describe(n: NotificationRow): { text: string; link: string; icon: typeof Bell } {
  const who = n.actor ? `@${n.actor.username}` : "Someone";
  const title = n.video?.title ? `“${n.video.title}”` : "your video";
  const video = n.video_id ? `/v/${n.video_id}` : "/";
  switch (n.type) {
    case "like":
      return { text: `${who} liked ${title}`, link: video, icon: Heart };
    case "comment":
      return { text: `${who} commented on ${title}: ${n.message}`, link: video, icon: MessageCircle };
    case "reply":
      return { text: `${who} replied to your comment: ${n.message}`, link: video, icon: AtSign };
    case "follow":
      return { text: `${who} started following you`, link: n.actor ? `/u/${n.actor.username}` : "/", icon: UserPlus };
    case "new_video":
      return { text: `${who} posted a new video: ${title}`, link: video, icon: Video };
    case "access_granted":
      return { text: `${who} gave you access to ${title}`, link: video, icon: KeyRound };
    case "creator_request":
      return { text: n.message || `${who} asked to become a creator`, link: "/admin?tab=creators", icon: Clapperboard };
    case "creator_approved":
      return { text: "You're now a creator! You can upload videos.", link: "/upload", icon: ShieldCheck };
    case "creator_rejected":
      return { text: `Your creator request wasn't approved${n.message ? `: ${n.message}` : "."}`, link: "/settings#creator", icon: CircleAlert };
    case "video_ready":
      return { text: `${title} finished processing`, link: n.video_id ? `/studio/videos/${n.video_id}` : "/studio", icon: Video };
    case "video_failed":
      return { text: `${title} couldn't be processed. Try uploading it again.`, link: n.video_id ? `/studio/videos/${n.video_id}` : "/studio", icon: CircleAlert };
    case "video_removed":
      return { text: `A moderator removed your video: ${n.message}`, link: n.video_id ? `/studio/videos/${n.video_id}` : "/studio", icon: CircleAlert };
    case "video_restored":
      return { text: `${title} was restored by a moderator`, link: video, icon: ShieldCheck };
    case "report_update":
      return { text: n.message, link: "/inbox", icon: ShieldCheck };
    default:
      return { text: n.message || "Account update", link: "/settings", icon: Bell };
  }
}

export default function InboxPage() {
  const toast = useToast();
  const notes = useAsync(() => listNotifications(), []);
  const unread = (notes.data ?? []).filter((n) => !n.read_at);

  // Opening the inbox marks everything as read (they stay highlighted until the next visit).
  useEffect(() => {
    if (unread.length > 0) markNotificationsRead(unread.map((n) => n.id)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.data]);

  if (notes.loading && !notes.data) return <PageLoader />;
  if (notes.error) return <ErrorState error={notes.error} onRetry={notes.reload} />;

  return (
    <div className="page page-narrow">
      <header className="page-header">
        <h1 className="page-title">Inbox</h1>
        {unread.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => markNotificationsRead().then(notes.reload)}>
            <CheckCheck size={16} /> Mark all read
          </button>
        )}
      </header>
      {(notes.data ?? []).length === 0 ? (
        <EmptyState icon={<Bell size={40} />} title="No notifications yet">
          Likes, comments, new followers and updates about your videos show up here.
        </EmptyState>
      ) : (
        <ul className="notification-list">
          {notes.data!.map((n) => {
            const d = describe(n);
            return (
              <li key={n.id} className={`notification${n.read_at ? "" : " unread"}`}>
                <Link to={d.link} className="notification-link">
                  {n.actor ? (
                    <Avatar src={n.actor.avatar_url} name={n.actor.username} size={40} />
                  ) : (
                    <span className="notification-icon">
                      <d.icon size={20} />
                    </span>
                  )}
                  <span className="notification-text">
                    <span>{d.text}</span>
                    <span className="muted small">{timeAgo(n.created_at)}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Delete notification"
                  onClick={() =>
                    deleteNotification(n.id)
                      .then(() => notes.setData((list) => (list ?? []).filter((x) => x.id !== n.id)))
                      .catch(toast.error)
                  }
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
