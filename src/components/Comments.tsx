import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EyeOff, Flag, MessageCircle, Reply, Send, Trash2, Eye } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { addComment, deleteComment, getComments, setCommentHidden } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { CommentRow, VideoCard } from "../lib/types";
import { Avatar } from "./Brand";
import { EmptyState, ErrorState, Spinner } from "./Feedback";
import { ReportDialog, useRequireSignIn } from "./VideoActions";
import { useToast } from "./Toast";

export function CommentsPanel({
  video,
  shareKey,
  onCountChange,
}: {
  video: VideoCard;
  shareKey?: string | null;
  onCountChange?: (delta: number) => void;
}) {
  const { user, isAdmin, profile } = useAuth();
  const toast = useToast();
  const requireSignIn = useRequireSignIn();
  const comments = useAsync(() => getComments(video.id, shareKey), [video.id, shareKey]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState<CommentRow | null>(null);
  const isOwner = user?.id === video.owner_id;
  const canModerate = isOwner || isAdmin;

  // Top-level comments newest first, replies oldest first under their parent.
  const threads = useMemo(() => {
    const list = comments.data ?? [];
    const replies = new Map<string, CommentRow[]>();
    for (const c of list) {
      if (c.parent_id) replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c]);
    }
    return list
      .filter((c) => !c.parent_id)
      .map((c) => ({ comment: c, replies: (replies.get(c.id) ?? []).reverse() }));
  }, [comments.data]);

  const submit = () =>
    requireSignIn(async () => {
      const text = body.trim();
      if (!text) return;
      setBusy(true);
      try {
        await addComment(video.id, text, replyTo ? (replyTo.parent_id ?? replyTo.id) : null);
        setBody("");
        setReplyTo(null);
        onCountChange?.(1);
        comments.reload();
      } catch (e) {
        toast.error(e);
      } finally {
        setBusy(false);
      }
    });

  const remove = async (c: CommentRow) => {
    try {
      await deleteComment(c.id);
      onCountChange?.(-1);
      comments.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const toggleHidden = async (c: CommentRow) => {
    try {
      await setCommentHidden(c.id, !c.is_hidden, isAdmin && !isOwner);
      comments.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const renderComment = (c: CommentRow, isReply = false) => (
    <li key={c.id} className={`comment${isReply ? " comment-reply" : ""}${c.is_hidden ? " comment-hidden" : ""}`}>
      <Link to={`/u/${c.username}`} aria-label={`@${c.username}`}>
        <Avatar src={c.avatar_url} name={c.username} size={isReply ? 28 : 34} />
      </Link>
      <div className="comment-main">
        <div className="comment-meta">
          <Link to={`/u/${c.username}`} className="comment-author">
            {c.display_name || c.username}
          </Link>
          {c.user_id === video.owner_id && <span className="badge badge-brand">Creator</span>}
          <span className="muted small">{timeAgo(c.created_at)}</span>
          {c.is_hidden && <span className="badge">Hidden</span>}
        </div>
        <p className="comment-body">{c.body}</p>
        <div className="comment-actions">
          {video.allow_comments && (
            <button type="button" className="link-btn" onClick={() => requireSignIn(() => setReplyTo(c))}>
              <Reply size={14} /> Reply
            </button>
          )}
          {user && c.user_id !== user.id && (
            <button type="button" className="link-btn" onClick={() => setReporting(c)}>
              <Flag size={14} /> Report
            </button>
          )}
          {canModerate && (
            <button type="button" className="link-btn" onClick={() => toggleHidden(c)}>
              {c.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />} {c.is_hidden ? "Unhide" : "Hide"}
            </button>
          )}
          {(c.user_id === user?.id || canModerate) && (
            <button type="button" className="link-btn danger" onClick={() => remove(c)}>
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );

  return (
    <div className="comments">
      <div className="comments-list">
        {comments.loading && !comments.data ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : comments.error ? (
          <ErrorState error={comments.error} onRetry={comments.reload} />
        ) : threads.length === 0 ? (
          <EmptyState icon={<MessageCircle size={32} />} title="No comments yet">
            {video.allow_comments ? "Start the conversation." : "Comments are turned off."}
          </EmptyState>
        ) : (
          <ul>
            {threads.map(({ comment, replies }) => (
              <li key={comment.id} className="thread">
                <ul>
                  {renderComment(comment)}
                  {replies.map((r) => renderComment(r, true))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {video.allow_comments ? (
        <form
          className="comment-composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {replyTo && (
            <div className="replying">
              Replying to @{replyTo.username}
              <button type="button" className="link-btn" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </div>
          )}
          <div className="composer-row">
            {profile && <Avatar src={profile.avatar_url} name={profile.username} size={32} />}
            <input
              className="input"
              placeholder={user ? "Add a comment…" : "Sign in to comment"}
              maxLength={1000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={() => !user && requireSignIn(() => undefined)}
              aria-label="Comment"
            />
            <button type="submit" className="icon-btn icon-btn-brand" disabled={busy || !body.trim()} aria-label="Post comment">
              <Send size={18} />
            </button>
          </div>
        </form>
      ) : (
        <p className="muted small center-pad">The creator turned off comments for this video.</p>
      )}

      {reporting && (
        <ReportDialog
          open
          onClose={() => setReporting(null)}
          target={{ commentId: reporting.id, videoId: video.id, label: "comment" }}
        />
      )}
    </div>
  );
}
