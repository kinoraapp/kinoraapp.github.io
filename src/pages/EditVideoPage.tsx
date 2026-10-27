import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, ImagePlus, RefreshCw, Save, Trash2, UploadCloud } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorState, InlineError, PageLoader, Spinner } from "../components/Feedback";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  AccessManager,
  PublishPicker,
  toVideoInput,
  validateVideoForm,
  VideoDetailsFields,
  VisibilityPicker,
  type VideoFormValues,
} from "../components/VideoForm";
import { StatusBadges, VisibilityBadge } from "../components/VideoGrid";
import { VideoPlayer } from "../components/VideoPlayer";
import { useAsync } from "../hooks/useAsync";
import {
  adminSetVideoModeration,
  deleteVideo,
  getVideo,
  refreshVideoStatus,
  removeThumbnail,
  requestUploadUrl,
  updateVideo,
  uploadThumbnail,
} from "../lib/api";
import { invalidatePlayback } from "../lib/playback";
import { dateTime, toLocalInput } from "../lib/format";
import type { VideoCard } from "../lib/types";
import { ACCEPTED_IMAGE_TYPES, ACCEPTED_VIDEO_TYPES, uploadToMux, validateVideoFile } from "../lib/upload";

function formFromVideo(v: VideoCard): VideoFormValues {
  const captionTags = new Set((v.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1).toLowerCase()));
  return {
    title: v.title,
    caption: v.caption,
    tagsText: v.hashtags.filter((t) => !captionTags.has(t)).join(" "),
    category: v.category_slug ?? "",
    visibility: v.visibility,
    allowComments: v.allow_comments,
    publishMode: v.status === "draft" ? "draft" : v.status === "scheduled" && !v.is_live ? "schedule" : "now",
    scheduleAt: v.publish_at && !v.is_live ? toLocalInput(new Date(v.publish_at)) : toLocalInput(new Date(Date.now() + 3600_000)),
  };
}

function Editor({ video, reload }: { video: VideoCard; reload: () => void }) {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [values, setValues] = useState(() => formFromVideo(video));
  const [errors, setErrors] = useState<Partial<Record<keyof VideoFormValues, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmModeration, setConfirmModeration] = useState(false);
  const [muted, setMuted] = useState(true);
  const [reupload, setReupload] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const isOwner = user?.id === video.owner_id;

  useEffect(() => setValues(formFromVideo(video)), [video]);

  const save = async () => {
    const errs = validateVideoForm(values);
    // Keeping an existing schedule that is already past is not an error.
    if (values.publishMode === "schedule" && video.status === "scheduled" && values.scheduleAt === formFromVideo(video).scheduleAt) {
      delete errs.scheduleAt;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input = toVideoInput(values);
      await updateVideo(video.id, input);
      toast.success("Changes saved");
      reload();
    } catch (e) {
      setSaveError(e);
    } finally {
      setSaving(false);
    }
  };

  const changeThumbnail = async (file: File | undefined) => {
    if (!file || !user) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > 5 * 1024 * 1024) {
      return toast.error("Use a JPG, PNG or WebP image up to 5 MB.");
    }
    try {
      await uploadThumbnail(video.id, user.id, file);
      invalidatePlayback(video.id);
      toast.success("Thumbnail updated");
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const replaceFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = validateVideoFile(file);
    if (problem) return toast.error(problem);
    setReupload(0);
    try {
      const { uploadUrl } = await requestUploadUrl(video.id);
      await uploadToMux(file, uploadUrl, setReupload).done;
      toast.success("Uploaded. Processing will finish in a minute or two.");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setReupload(null);
    }
  };

  const checkStatus = async () => {
    setChecking(true);
    try {
      const { status } = await refreshVideoStatus(video.id);
      if (status !== video.processing_status) reload();
      else toast.info(status === "ready" ? "Ready" : "Still processing");
    } catch (e) {
      toast.error(e);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <Link to={isOwner ? "/studio" : "/admin?tab=videos"} className="btn btn-ghost btn-sm">
          <ArrowLeft size={16} /> Back
        </Link>
        <h1 className="page-title truncate">Edit video</h1>
        <Link to={`/v/${video.id}`} className="btn btn-secondary btn-sm">
          <ExternalLink size={14} /> View
        </Link>
      </header>
      {!isOwner && (
        <p className="notice">
          You're editing @{video.username}'s video as an administrator. Changes are recorded under your account.
        </p>
      )}

      <div className="upload-layout">
        <div className="upload-preview">
          <div className="upload-video">
            {video.processing_status === "ready" ? (
              <VideoPlayer videoId={video.id} active={false} load muted={muted} onMutedChange={setMuted} fit="contain" />
            ) : (
              <div className="processing-box">
                {video.processing_status === "errored" ? (
                  <>
                    <p className="text-danger">Processing failed{video.processing_error ? `: ${video.processing_error}` : ""}.</p>
                    <p className="muted small">Upload the file again, or a different one.</p>
                  </>
                ) : (
                  <>
                    <Spinner />
                    <p>{video.processing_status === "awaiting_upload" ? "Waiting for the video file." : "Processing…"}</p>
                  </>
                )}
                <div className="button-row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={checkStatus} disabled={checking}>
                    <RefreshCw size={14} /> Check status
                  </button>
                  {isOwner && video.processing_status !== "processing" && (
                    <label className="btn btn-primary btn-sm">
                      <UploadCloud size={14} /> {reupload !== null ? `Uploading ${reupload}%` : "Upload file"}
                      <input
                        type="file"
                        className="sr-only"
                        accept={[...ACCEPTED_VIDEO_TYPES, ".mov", ".m4v"].join(",")}
                        disabled={reupload !== null}
                        onChange={(e) => replaceFile(e.target.files?.[0])}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="badge-row">
            <VisibilityBadge visibility={video.visibility} />
            <StatusBadges video={video} />
          </div>
          {video.status === "scheduled" && !video.is_live && <p className="muted small">Goes live {dateTime(video.publish_at)}.</p>}
          {video.moderation_status === "removed" && (
            <p className="notice notice-danger">
              Removed by moderators{video.moderation_reason ? `: ${video.moderation_reason}` : ""}. It's hidden from everyone except you and
              administrators.
            </p>
          )}
          {isOwner && (
            <div className="thumb-actions">
              <label className="btn btn-secondary btn-sm">
                <ImagePlus size={14} /> {video.thumbnail_path ? "Replace thumbnail" : "Custom thumbnail"}
                <input type="file" className="sr-only" accept={ACCEPTED_IMAGE_TYPES.join(",")} onChange={(e) => changeThumbnail(e.target.files?.[0])} />
              </label>
              {video.thumbnail_path && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    removeThumbnail(video.id, video.owner_id)
                      .then(() => {
                        invalidatePlayback(video.id);
                        reload();
                      })
                      .catch(toast.error)
                  }
                >
                  Use automatic thumbnail
                </button>
              )}
            </div>
          )}
        </div>

        <div className="upload-form">
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <VideoDetailsFields values={values} onChange={(p) => setValues((v) => ({ ...v, ...p }))} errors={errors} />
            <VisibilityPicker value={values.visibility} onChange={(visibility) => setValues((v) => ({ ...v, visibility }))} />
            <PublishPicker values={values} onChange={(p) => setValues((v) => ({ ...v, ...p }))} error={errors.scheduleAt} />
            <InlineError error={saveError} />
            <div className="button-row end">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Save size={16} /> {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>

          <div className="card">
            <h2 className="card-title">Access</h2>
            {values.visibility !== video.visibility && <p className="notice">Save your changes to apply the new visibility.</p>}
            <AccessManager videoId={video.id} visibility={values.visibility} ownerId={video.owner_id} />
          </div>

          <div className="card danger-zone">
            <h2 className="card-title">Danger zone</h2>
            {isAdmin && (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmModeration(true)}>
                {video.moderation_status === "removed" ? "Restore video" : "Remove for policy violation"}
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} /> Delete video
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this video?"
        message="The video file, thumbnail, likes, comments and stats will be permanently deleted. This can't be undone."
        confirmLabel="Delete forever"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await deleteVideo(video.id);
            toast.success("Video deleted");
            navigate(isOwner ? "/studio" : "/admin?tab=videos", { replace: true });
          } catch (e) {
            toast.error(e);
          }
        }}
      />
      <ConfirmDialog
        open={confirmModeration}
        title={video.moderation_status === "removed" ? "Restore this video?" : "Remove this video?"}
        message={
          video.moderation_status === "removed"
            ? "It becomes visible again according to its visibility setting."
            : "It's hidden from everyone except the owner and administrators. The owner is notified."
        }
        reasonLabel={video.moderation_status === "removed" ? undefined : "Reason shown to the owner"}
        confirmLabel={video.moderation_status === "removed" ? "Restore" : "Remove"}
        danger={video.moderation_status !== "removed"}
        onClose={() => setConfirmModeration(false)}
        onConfirm={async (reason) => {
          try {
            await adminSetVideoModeration(video.id, video.moderation_status === "removed" ? "active" : "removed", reason);
            reload();
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </div>
  );
}

export default function EditVideoPage() {
  const { id = "" } = useParams();
  const { user, isAdmin } = useAuth();
  const video = useAsync(() => getVideo(id), [id]);
  if (video.loading && !video.data) return <PageLoader />;
  if (video.error) return <ErrorState error={video.error} onRetry={video.reload} />;
  if (!video.data || (video.data.owner_id !== user?.id && !isAdmin)) {
    return (
      <div className="page page-narrow">
        <EmptyState title="You can't edit this video" action={<Link to="/studio" className="btn btn-secondary">Back to studio</Link>}>
          Only the owner and administrators can edit a video.
        </EmptyState>
      </div>
    );
  }
  return <Editor video={video.data} reload={video.reload} />;
}
