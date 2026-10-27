import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Copy, Flag, ListPlus, Plus, Share2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  createPlaylist,
  getShareKey,
  listMyPlaylists,
  playlistsContaining,
  recordShare,
  setInPlaylist,
  setLiked,
  setSaved,
  shareUrl,
  submitReport,
} from "../lib/api";
import { reportReasonLabel } from "../lib/format";
import type { Playlist, ReportReason, VideoCard } from "../lib/types";
import { InlineError, Spinner } from "./Feedback";
import { Modal } from "./Modal";
import { useToast } from "./Toast";

/** Sends signed-out visitors to the login page, then back here. */
export function useRequireSignIn() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (action: () => void) => {
      if (!user) {
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      action();
    },
    [user, navigate, location],
  );
}

/** Optimistic like/save state for one video. */
export function useVideoSocial(video: VideoCard, initial: { liked: boolean; saved: boolean }) {
  const toast = useToast();
  const requireSignIn = useRequireSignIn();
  const [liked, setLikedState] = useState(initial.liked);
  const [saved, setSavedState] = useState(initial.saved);
  const [likeCount, setLikeCount] = useState(video.like_count);
  const [saveCount, setSaveCount] = useState(video.save_count);

  useEffect(() => setLikedState(initial.liked), [initial.liked]);
  useEffect(() => setSavedState(initial.saved), [initial.saved]);

  const toggleLike = (force?: boolean) =>
    requireSignIn(async () => {
      const next = force ?? !liked;
      if (next === liked) return;
      setLikedState(next);
      setLikeCount((c) => c + (next ? 1 : -1));
      try {
        await setLiked(video.id, next);
      } catch (e) {
        setLikedState(!next);
        setLikeCount((c) => c + (next ? -1 : 1));
        toast.error(e);
      }
    });

  const toggleSave = () =>
    requireSignIn(async () => {
      const next = !saved;
      setSavedState(next);
      setSaveCount((c) => c + (next ? 1 : -1));
      try {
        await setSaved(video.id, next);
        toast.success(next ? "Saved to your library" : "Removed from saved");
      } catch (e) {
        setSavedState(!next);
        setSaveCount((c) => c + (next ? -1 : 1));
        toast.error(e);
      }
    });

  return { liked, saved, likeCount, saveCount, toggleLike, toggleSave };
}

export function ShareDialog({
  video,
  shareKey,
  open,
  onClose,
}: {
  video: VideoCard;
  shareKey?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [key, setKey] = useState<string | null>(shareKey ?? null);
  const [copied, setCopied] = useState(false);

  // Owners sharing an unlisted video need its secret key in the link.
  useEffect(() => {
    if (open && video.visibility === "unlisted" && !shareKey && user?.id === video.owner_id) {
      getShareKey(video.id).then(setKey).catch(() => undefined);
    }
  }, [open, video, shareKey, user]);

  const url = shareUrl(video.id, video.visibility === "unlisted" ? key : null);
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      recordShare(video.id, shareKey).catch(() => undefined);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Share video" variant="sheet">
      {video.visibility === "private" && (
        <p className="notice notice-warning">This video is private. Only you and administrators can open the link.</p>
      )}
      {video.visibility === "selected" && (
        <p className="notice">Only people you've given access can open this link. They need to sign in.</p>
      )}
      {video.visibility === "unlisted" && (
        <p className="notice">Anyone with this link can watch. It won't appear in feeds or search.</p>
      )}
      <div className="share-row">
        <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Video link" />
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {canNativeShare && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() =>
            navigator
              .share({ title: video.title, text: `${video.title} on ${document.title}`, url })
              .then(() => recordShare(video.id, shareKey).catch(() => undefined))
              .catch(() => undefined)
          }
        >
          <Share2 size={16} /> Share via…
        </button>
      )}
    </Modal>
  );
}

export function ReportDialog({
  target,
  open,
  onClose,
}: {
  target: { videoId?: string; commentId?: string; userId?: string; label: string };
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitReport({
        videoId: target.videoId,
        commentId: target.commentId,
        reportedUserId: target.userId,
        reason,
        details: details.trim(),
      });
      toast.success("Thanks. Our moderators will review this.");
      setDetails("");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Report ${target.label}`}
      variant="sheet"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={busy}>
            <Flag size={16} /> {busy ? "Sending…" : "Send report"}
          </button>
        </>
      }
    >
      <fieldset className="radio-list">
        <legend className="label">Why are you reporting this?</legend>
        {(Object.keys(reportReasonLabel) as ReportReason[]).map((r) => (
          <label key={r} className="radio-row">
            <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
            <span>{reportReasonLabel[r]}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="label">Details (optional)</span>
        <textarea
          className="input"
          rows={3}
          maxLength={1000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Anything that helps us understand the problem"
        />
      </label>
      <InlineError error={error} />
    </Modal>
  );
}

/** Save / unsave plus "add to playlist". */
export function SaveDialog({
  video,
  saved,
  onToggleSave,
  open,
  onClose,
}: {
  video: VideoCard;
  saved: boolean;
  onToggleSave: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [inLists, setInLists] = useState<Set<string>>(new Set());
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    Promise.all([listMyPlaylists(), playlistsContaining(video.id)])
      .then(([lists, containing]) => {
        setPlaylists(lists);
        setInLists(containing);
      })
      .catch(setError);
  }, [open, video.id]);

  const toggle = async (playlist: Playlist) => {
    const next = !inLists.has(playlist.id);
    setInLists((s) => {
      const copy = new Set(s);
      if (next) copy.add(playlist.id);
      else copy.delete(playlist.id);
      return copy;
    });
    try {
      await setInPlaylist(playlist.id, video.id, next);
    } catch (e) {
      toast.error(e);
    }
  };

  const create = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const playlist = await createPlaylist(title);
      await setInPlaylist(playlist.id, video.id, true);
      setPlaylists((p) => [{ ...playlist, video_count: 1 }, ...(p ?? [])]);
      setInLists((s) => new Set(s).add(playlist.id));
      setNewTitle("");
      toast.success(`Added to “${title}”`);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Save" variant="sheet">
      <label className="check-row">
        <input type="checkbox" checked={saved} onChange={onToggleSave} />
        <span>Saved videos</span>
      </label>
      <h3 className="section-label">
        <ListPlus size={16} /> Playlists
      </h3>
      {error ? (
        <InlineError error={error} />
      ) : playlists === null ? (
        <Spinner />
      ) : (
        <div className="check-list">
          {playlists.length === 0 && <p className="muted">No playlists yet.</p>}
          {playlists.map((p) => (
            <label key={p.id} className="check-row">
              <input type="checkbox" checked={inLists.has(p.id)} onChange={() => toggle(p)} />
              <span>{p.title}</span>
              <span className="muted small">{p.is_public ? "Public" : "Private"}</span>
            </label>
          ))}
        </div>
      )}
      <form
        className="share-row"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          className="input"
          placeholder="New playlist name"
          maxLength={80}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary" disabled={!newTitle.trim()}>
          <Plus size={16} /> Create
        </button>
      </form>
    </Modal>
  );
}
