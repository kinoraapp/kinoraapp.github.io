import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bookmark, Globe, Heart, ListVideo, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorState, InlineError, PageLoader, Spinner } from "../components/Feedback";
import { ConfirmDialog, Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { VideoGrid } from "../components/VideoGrid";
import { useAsync } from "../hooks/useAsync";
import { createPlaylist, deletePlaylist, getPlaylist, listLiked, listMyPlaylists, listSaved, setInPlaylist, updatePlaylist } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { Playlist } from "../lib/types";

function PlaylistEditor({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial?: Playlist;
  onClose: () => void;
  onSave: (values: { title: string; description: string; is_public: boolean }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit playlist" : "New playlist"}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !title.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSave({ title: title.trim(), description: description.trim(), is_public: isPublic });
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span className="label">Name</span>
        <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Description</span>
        <textarea className="input" rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        <span>Public: show on my profile (private videos in it stay private)</span>
      </label>
      <InlineError error={error} />
    </Modal>
  );
}

export function LibraryPage() {
  const [tab, setTab] = useState<"saved" | "liked" | "playlists">("saved");
  const [creating, setCreating] = useState(false);
  const saved = useAsync(() => (tab === "saved" ? listSaved() : Promise.resolve(null)), [tab]);
  const liked = useAsync(() => (tab === "liked" ? listLiked() : Promise.resolve(null)), [tab]);
  const playlists = useAsync(() => (tab === "playlists" ? listMyPlaylists() : Promise.resolve(null)), [tab]);
  const current = tab === "saved" ? saved : tab === "liked" ? liked : playlists;

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Library</h1>
        {tab === "playlists" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus size={16} /> New playlist
          </button>
        )}
      </header>
      <div className="tabs" role="tablist">
        {(
          [
            ["saved", <Bookmark size={16} key="s" />, "Saved"],
            ["liked", <Heart size={16} key="l" />, "Liked"],
            ["playlists", <ListVideo size={16} key="p" />, "Playlists"],
          ] as const
        ).map(([key, icon, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
            {icon} {label}
          </button>
        ))}
      </div>

      {current.loading ? (
        <div className="center-pad">
          <Spinner />
        </div>
      ) : current.error ? (
        <ErrorState error={current.error} onRetry={current.reload} />
      ) : tab === "playlists" ? (
        (playlists.data ?? []).length === 0 ? (
          <EmptyState icon={<ListVideo size={36} />} title="No playlists yet">
            Group videos into playlists from the Save button on any video.
          </EmptyState>
        ) : (
          <ul className="playlist-list">
            {playlists.data!.map((p) => (
              <li key={p.id}>
                <Link to={`/library/playlists/${p.id}`} className="playlist-card">
                  <ListVideo size={22} />
                  <span>
                    <strong>{p.title}</strong>
                    <span className="muted small">
                      {p.video_count} videos · {p.is_public ? "Public" : "Private"} · updated {timeAgo(p.updated_at)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : ((tab === "saved" ? saved.data : liked.data) ?? []).length === 0 ? (
        <EmptyState icon={tab === "saved" ? <Bookmark size={36} /> : <Heart size={36} />} title={tab === "saved" ? "Nothing saved yet" : "No liked videos yet"}>
          {tab === "saved" ? "Tap the bookmark on a video to keep it here." : "Videos you like show up here. Only you can see this list."}
        </EmptyState>
      ) : (
        <VideoGrid videos={(tab === "saved" ? saved.data : liked.data)!} />
      )}

      {creating && (
        <PlaylistEditor
          open
          onClose={() => setCreating(false)}
          onSave={async (v) => {
            await createPlaylist(v.title, v.description, v.is_public);
            playlists.reload();
          }}
        />
      )}
    </div>
  );
}

export function PlaylistPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const data = useAsync(() => getPlaylist(id), [id]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (data.loading) return <PageLoader />;
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  if (!data.data) {
    return (
      <div className="page page-narrow">
        <EmptyState icon={<Lock size={36} />} title="Playlist not found">
          It may be private or deleted.
        </EmptyState>
      </div>
    );
  }
  const { playlist, videos } = data.data;
  const mine = playlist.owner_id === user?.id;

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="grow">
          <h1 className="page-title">{playlist.title}</h1>
          <p className="muted small">
            {playlist.is_public ? <Globe size={12} /> : <Lock size={12} />} {playlist.is_public ? "Public" : "Private"} · {videos.length} videos
          </p>
        </div>
        {mine && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </button>
            <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setDeleting(true)} aria-label="Delete playlist">
              <Trash2 size={14} />
            </button>
          </>
        )}
      </header>
      {playlist.description && <p className="muted">{playlist.description}</p>}
      {videos.length === 0 ? (
        <EmptyState icon={<ListVideo size={36} />} title="This playlist is empty" />
      ) : (
        <>
          <VideoGrid videos={videos} />
          {mine && (
            <details className="card">
              <summary>Remove videos</summary>
              <ul className="people-list">
                {videos.map((v) => (
                  <li key={v.id}>
                    <span className="people-name truncate">{v.title}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setInPlaylist(playlist.id, v.id, false)
                          .then(data.reload)
                          .catch(toast.error)
                      }
                    >
                      <Trash2 size={14} /> Remove
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {editing && (
        <PlaylistEditor
          open
          initial={playlist}
          onClose={() => setEditing(false)}
          onSave={async (v) => {
            await updatePlaylist(playlist.id, v);
            data.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        title="Delete playlist?"
        message="The playlist is deleted. The videos in it are not affected."
        confirmLabel="Delete"
        danger
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          try {
            await deletePlaylist(playlist.id);
            navigate("/library", { replace: true });
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </div>
  );
}
