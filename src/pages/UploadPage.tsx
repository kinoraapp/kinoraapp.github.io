import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Film, ImagePlus, RefreshCw, Scissors, UploadCloud, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { InlineError, Spinner } from "../components/Feedback";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  emptyVideoForm,
  PublishPicker,
  toVideoInput,
  UserPicker,
  validateVideoForm,
  VideoDetailsFields,
  VisibilityPicker,
  type VideoFormValues,
} from "../components/VideoForm";
import { env } from "../config/env";
import { createVideo, deleteVideo, grantVideoAccess, requestUploadUrl, uploadThumbnail } from "../lib/api";
import { bytes, duration } from "../lib/format";
import type { Profile } from "../lib/types";
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  captureFrame,
  readVideoInfo,
  uploadToMux,
  validateVideoFile,
  waitUntilProcessed,
  type UploadHandle,
  type VideoFileInfo,
} from "../lib/upload";

type Phase = "form" | "uploading" | "processing" | "done" | "failed";

export default function UploadPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<VideoFileInfo | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [values, setValues] = useState<VideoFormValues>(emptyVideoForm);
  const [errors, setErrors] = useState<Partial<Record<keyof VideoFormValues, string>>>({});
  const [thumb, setThumb] = useState<Blob | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  const [phase, setPhase] = useState<Phase>("form");
  const [progress, setProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState("processing");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const uploadRef = useRef<UploadHandle | null>(null);
  const pollSignal = useRef({ cancelled: false });
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => () => {
    pollSignal.current.cancelled = true;
  }, []);

  // Release object URLs when they change.
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);
  useEffect(() => () => void (thumbUrl && URL.revokeObjectURL(thumbUrl)), [thumbUrl]);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (phase !== "uploading") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const chooseFile = async (f: File | undefined) => {
    if (!f) return;
    const problem = validateVideoFile(f);
    setFileError(problem);
    if (problem) return;
    const url = URL.createObjectURL(f);
    const meta = await readVideoInfo(url);
    if (meta.duration && meta.duration > env.maxVideoMinutes * 60) {
      URL.revokeObjectURL(url);
      setFileError(`Videos can be up to ${env.maxVideoMinutes} minutes long. This one is ${duration(meta.duration)}.`);
      return;
    }
    setFile(f);
    setPreviewUrl(url);
    setInfo(meta);
    if (!values.title) setValues((v) => ({ ...v, title: f.name.replace(/\.[^.]+$/, "").slice(0, 120) }));
  };

  const chooseThumb = (f: File | undefined) => {
    if (!f) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) return toast.error("Use a JPG, PNG or WebP image.");
    if (f.size > 5 * 1024 * 1024) return toast.error("Thumbnails can be up to 5 MB.");
    setThumb(f);
    setThumbUrl(URL.createObjectURL(f));
  };

  const captureCurrentFrame = async () => {
    const video = previewRef.current;
    if (!video) return;
    const blob = await captureFrame(video);
    if (!blob) return toast.error("Couldn't capture this frame. Try uploading an image instead.");
    setThumb(blob);
    setThumbUrl(URL.createObjectURL(blob));
  };

  const startUpload = async (id: string, f: File) => {
    setPhase("uploading");
    setProgress(0);
    setFailure(null);
    try {
      const { uploadUrl } = await requestUploadUrl(id);
      uploadRef.current = uploadToMux(f, uploadUrl, setProgress);
      await uploadRef.current.done;
      setPhase("processing");
      pollSignal.current = { cancelled: false };
      const status = await waitUntilProcessed(id, setProcessingStatus, pollSignal.current);
      if (status === "errored") throw new Error("The video service couldn't process this file. Try a different file or format.");
      setPhase("done");
    } catch (e) {
      if (pollSignal.current.cancelled) return;
      setFailure(e);
      setPhase("failed");
    } finally {
      uploadRef.current = null;
    }
  };

  const submit = async () => {
    if (!file || !user) return;
    const errs = validateVideoForm(values);
    if (values.visibility === "selected" && selectedUsers.length === 0) {
      toast.info("No one is selected yet. You can add people later from your studio.");
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const id = await createVideo({ ...toVideoInput(values), original_filename: file.name.slice(0, 255), size_bytes: file.size });
      setVideoId(id);
      if (thumb) await uploadThumbnail(id, user.id, thumb).catch((e) => toast.error(e));
      if (values.visibility === "selected") {
        for (const p of selectedUsers) await grantVideoAccess(id, p.username).catch((e) => toast.error(e));
      }
      await startUpload(id, file);
    } catch (e) {
      setFailure(e);
      setPhase("failed");
    }
  };

  const cancelUpload = async () => {
    uploadRef.current?.abort();
    pollSignal.current.cancelled = true;
    if (videoId) await deleteVideo(videoId).catch(() => undefined);
    reset();
    toast.info("Upload cancelled");
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setInfo(null);
    setThumb(null);
    setThumbUrl(null);
    setValues(emptyVideoForm());
    setSelectedUsers([]);
    setVideoId(null);
    setPhase("form");
    setProgress(0);
    setFailure(null);
    setErrors({});
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (phase === "form") chooseFile(e.dataTransfer.files?.[0]);
  };

  if (phase === "done" && videoId) {
    const live = values.publishMode === "now";
    return (
      <div className="page page-narrow">
        <div className="empty-state">
          <CheckCircle2 size={48} className="text-success" />
          <h1>{live ? "Your video is live" : values.publishMode === "schedule" ? "Your video is scheduled" : "Draft saved"}</h1>
          <p>
            {live
              ? values.visibility === "public"
                ? "It now appears in the feed and on your profile."
                : "Only the people allowed by its visibility setting can watch it."
              : values.publishMode === "schedule"
                ? `It will go live on ${new Date(values.scheduleAt).toLocaleString()}.`
                : "Publish it from your studio whenever you're ready."}
          </p>
          <div className="button-row">
            <Link to={`/v/${videoId}`} className="btn btn-primary">
              View video
            </Link>
            <Link to={`/studio/videos/${videoId}`} className="btn btn-secondary">
              Edit details
            </Link>
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Upload another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const busy = phase === "uploading" || phase === "processing";

  return (
    <div className="page" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="page-header">
        <h1 className="page-title">Upload video</h1>
        <Link to="/studio" className="btn btn-ghost btn-sm">
          Your videos
        </Link>
      </header>

      {!file ? (
        <label
          className={`dropzone${dragging ? " dragging" : ""}`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
        >
          <input
            type="file"
            accept={[...ACCEPTED_VIDEO_TYPES, ".mov", ".m4v"].join(",")}
            className="sr-only"
            onChange={(e) => chooseFile(e.target.files?.[0])}
          />
          <UploadCloud size={48} aria-hidden />
          <strong>Select a video to upload</strong>
          <span className="muted">or drag and drop it here</span>
          <span className="muted small">
            MP4, WebM or MOV · up to {env.maxUploadMb >= 1024 ? `${env.maxUploadMb / 1024} GB` : `${env.maxUploadMb} MB`} · up to{" "}
            {env.maxVideoMinutes} minutes · vertical 9:16 looks best
          </span>
          <span className="btn btn-primary">Choose file</span>
          {fileError && (
            <span className="field-error" role="alert">
              {fileError}
            </span>
          )}
        </label>
      ) : (
        <div className="upload-layout">
          <div className="upload-preview">
            <div className="upload-video">
              <video ref={previewRef} src={previewUrl ?? undefined} controls playsInline muted preload="metadata" />
            </div>
            <div className="upload-file-meta">
              <Film size={16} />
              <span className="truncate">{file.name}</span>
              <span className="muted small">
                {bytes(file.size)}
                {info?.duration ? ` · ${duration(info.duration)}` : ""}
                {info?.width ? ` · ${info.width}×${info.height}` : ""}
              </span>
              {!busy && (
                <button type="button" className="icon-btn" onClick={reset} aria-label="Remove video">
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="thumb-picker">
              <span className="label">Thumbnail</span>
              <div className="thumb-row">
                <div className="thumb-preview">{thumbUrl ? <img src={thumbUrl} alt="Selected thumbnail" /> : <span className="muted small">Auto</span>}</div>
                <div className="thumb-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={captureCurrentFrame} disabled={busy || !info?.width}>
                    <Scissors size={14} /> Use current frame
                  </button>
                  <label className={`btn btn-secondary btn-sm${busy ? " disabled" : ""}`}>
                    <ImagePlus size={14} /> Upload image
                    <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => chooseThumb(e.target.files?.[0])} />
                  </label>
                  {thumb && (
                    <button type="button" className="link-btn" onClick={() => { setThumb(null); setThumbUrl(null); }} disabled={busy}>
                      Use automatic thumbnail
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <form
            className="upload-form card"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <fieldset disabled={busy || phase === "failed"} className="plain-fieldset">
              <VideoDetailsFields values={values} onChange={(p) => setValues((v) => ({ ...v, ...p }))} errors={errors} />
              <VisibilityPicker value={values.visibility} onChange={(visibility) => setValues((v) => ({ ...v, visibility }))} />
              {values.visibility === "selected" && (
                <div className="field">
                  <span className="label">People who can watch</span>
                  <UserPicker selected={selectedUsers} onChange={setSelectedUsers} />
                </div>
              )}
              <PublishPicker values={values} onChange={(p) => setValues((v) => ({ ...v, ...p }))} error={errors.scheduleAt} />
            </fieldset>

            {phase === "uploading" && (
              <div className="upload-progress" aria-live="polite">
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <span>Uploading… {progress}%</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(true)}>
                  Cancel
                </button>
              </div>
            )}
            {phase === "processing" && (
              <div className="upload-progress" aria-live="polite">
                <Spinner size={20} />
                <span>
                  Upload complete. Processing video{processingStatus === "awaiting_upload" ? " (waiting for the file)" : ""}… You can leave
                  this page; it'll finish in the background.
                </span>
              </div>
            )}
            {phase === "failed" && (
              <div className="upload-failed" role="alert">
                <InlineError error={failure} />
                <div className="button-row">
                  {videoId && file && (
                    <button type="button" className="btn btn-primary" onClick={() => startUpload(videoId, file)}>
                      <RefreshCw size={16} /> Retry upload
                    </button>
                  )}
                  {videoId ? (
                    <Link to={`/studio/videos/${videoId}`} className="btn btn-secondary">
                      Open in studio
                    </Link>
                  ) : (
                    <button type="button" className="btn btn-secondary" onClick={() => setPhase("form")}>
                      Back to the form
                    </button>
                  )}
                </div>
              </div>
            )}
            {phase === "form" && (
              <div className="button-row end">
                <button type="button" className="btn btn-ghost" onClick={reset}>
                  Discard
                </button>
                <button type="submit" className="btn btn-primary">
                  <UploadCloud size={18} />
                  {values.publishMode === "now" ? "Upload & publish" : values.publishMode === "schedule" ? "Upload & schedule" : "Upload as draft"}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this upload?"
        message="The upload stops and the video is deleted."
        confirmLabel="Cancel upload"
        danger
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancelUpload}
      />
    </div>
  );
}
