import { useEffect, useState } from "react";
import { Calendar, Check, Copy, FileText, Globe, Link2, Lock, RefreshCw, Send, Trash2, UserPlus, Users } from "lucide-react";
import { useAsync } from "../hooks/useAsync";
import {
  getShareKey,
  grantVideoAccess,
  listCategories,
  listVideoAccess,
  revokeVideoAccess,
  rotateShareKey,
  searchProfiles,
  shareUrl,
} from "../lib/api";
import { parseHashtags, timeAgo, toLocalInput } from "../lib/format";
import type { Profile, VideoStatus, Visibility } from "../lib/types";
import { useDebounced } from "../hooks/useBrowser";
import { Avatar } from "./Brand";
import { InlineError, Spinner } from "./Feedback";
import { ConfirmDialog } from "./Modal";
import { useToast } from "./Toast";

export interface VideoFormValues {
  title: string;
  caption: string;
  tagsText: string;
  category: string;
  visibility: Visibility;
  allowComments: boolean;
  publishMode: "draft" | "now" | "schedule";
  scheduleAt: string;
}

export const emptyVideoForm = (): VideoFormValues => ({
  title: "",
  caption: "",
  tagsText: "",
  category: "",
  visibility: "public",
  allowComments: true,
  publishMode: "now",
  scheduleAt: toLocalInput(new Date(Date.now() + 3600_000)),
});

/** Validates the form; returns field errors (empty when valid). */
export function validateVideoForm(v: VideoFormValues): Partial<Record<keyof VideoFormValues, string>> {
  const errors: Partial<Record<keyof VideoFormValues, string>> = {};
  if (!v.title.trim()) errors.title = "Add a title.";
  else if (v.title.trim().length > 120) errors.title = "Keep the title under 120 characters.";
  if (v.caption.length > 2200) errors.caption = "Captions can be up to 2,200 characters.";
  if (v.publishMode === "schedule") {
    const at = new Date(v.scheduleAt);
    if (Number.isNaN(at.getTime())) errors.scheduleAt = "Pick a date and time.";
    else if (at.getTime() < Date.now() + 60_000) errors.scheduleAt = "Pick a time at least a minute from now.";
  }
  return errors;
}

/** Converts form values into the database fields. */
export function toVideoInput(v: VideoFormValues) {
  const status: VideoStatus = v.publishMode === "draft" ? "draft" : v.publishMode === "schedule" ? "scheduled" : "published";
  return {
    title: v.title.trim(),
    caption: v.caption.trim(),
    hashtags: parseHashtags(v.tagsText),
    category_slug: v.category || null,
    visibility: v.visibility,
    status,
    publish_at: v.publishMode === "schedule" ? new Date(v.scheduleAt).toISOString() : null,
    allow_comments: v.allowComments,
  };
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string; help: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", help: "Anyone can watch. Shown in feeds, search and your profile.", icon: Globe },
  { value: "unlisted", label: "Unlisted", help: "Only people with the secret link can watch. Hidden from feeds and search.", icon: Link2 },
  { value: "selected", label: "Selected users", help: "Only signed-in people you choose can watch.", icon: Users },
  { value: "private", label: "Private", help: "Only you and administrators can watch.", icon: Lock },
];

export function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <fieldset className="option-cards">
      <legend className="label">Who can watch</legend>
      {VISIBILITY_OPTIONS.map((o) => (
        <label key={o.value} className={`option-card${value === o.value ? " selected" : ""}`}>
          <input type="radio" name="visibility" value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <o.icon size={20} aria-hidden />
          <span>
            <strong>{o.label}</strong>
            <span className="muted small">{o.help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function PublishPicker({
  values,
  onChange,
  error,
}: {
  values: VideoFormValues;
  onChange: (patch: Partial<VideoFormValues>) => void;
  error?: string;
}) {
  const options = [
    { value: "now" as const, label: "Publish now", icon: Send },
    { value: "schedule" as const, label: "Schedule", icon: Calendar },
    { value: "draft" as const, label: "Save as draft", icon: FileText },
  ];
  return (
    <fieldset className="field">
      <legend className="label">When</legend>
      <div className="segmented" role="radiogroup">
        {options.map((o) => (
          <label key={o.value} className={`segment${values.publishMode === o.value ? " selected" : ""}`}>
            <input
              type="radio"
              name="publishMode"
              value={o.value}
              checked={values.publishMode === o.value}
              onChange={() => onChange({ publishMode: o.value })}
            />
            <o.icon size={16} aria-hidden /> {o.label}
          </label>
        ))}
      </div>
      {values.publishMode === "schedule" && (
        <label className="field">
          <span className="label">Publish on</span>
          <input
            type="datetime-local"
            className="input"
            value={values.scheduleAt}
            min={toLocalInput(new Date())}
            onChange={(e) => onChange({ scheduleAt: e.target.value })}
            aria-invalid={!!error}
          />
          <span className="hint">Your time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
          {error && <span className="field-error">{error}</span>}
        </label>
      )}
      {values.publishMode === "draft" && <span className="hint">Drafts are only visible to you and administrators.</span>}
    </fieldset>
  );
}

export function VideoDetailsFields({
  values,
  onChange,
  errors,
}: {
  values: VideoFormValues;
  onChange: (patch: Partial<VideoFormValues>) => void;
  errors: Partial<Record<keyof VideoFormValues, string>>;
}) {
  const categories = useAsync(() => listCategories(), []);
  const tags = parseHashtags(`${values.tagsText} ${(values.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).join(" ")}`);
  return (
    <>
      <label className="field">
        <span className="label">Title</span>
        <input
          className="input"
          maxLength={120}
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Give your video a title"
          aria-invalid={!!errors.title}
          required
        />
        {errors.title && <span className="field-error">{errors.title}</span>}
      </label>
      <label className="field">
        <span className="label">
          Caption <span className="muted small">{values.caption.length}/2200</span>
        </span>
        <textarea
          className="input"
          rows={4}
          maxLength={2200}
          value={values.caption}
          onChange={(e) => onChange({ caption: e.target.value })}
          placeholder="Describe your video. #Hashtags in the caption are picked up automatically."
          aria-invalid={!!errors.caption}
        />
        {errors.caption && <span className="field-error">{errors.caption}</span>}
      </label>
      <label className="field">
        <span className="label">More hashtags</span>
        <input
          className="input"
          value={values.tagsText}
          onChange={(e) => onChange({ tagsText: e.target.value })}
          placeholder="dance, tutorial, #weekend"
        />
        {tags.length > 0 && (
          <span className="tag-list">
            {tags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </span>
        )}
      </label>
      <div className="field-row">
        <label className="field">
          <span className="label">Category</span>
          <select className="input" value={values.category} onChange={(e) => onChange({ category: e.target.value })}>
            <option value="">None</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row field-check">
          <input type="checkbox" checked={values.allowComments} onChange={(e) => onChange({ allowComments: e.target.checked })} />
          <span>Allow comments</span>
        </label>
      </div>
    </>
  );
}

/** Pick people by username (used before a video exists, on the upload page). */
export function UserPicker({ selected, onChange }: { selected: Profile[]; onChange: (p: Profile[]) => void }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const results = useAsync(() => (debounced ? searchProfiles(debounced) : Promise.resolve([])), [debounced]);
  const add = (p: Profile) => {
    if (!selected.some((s) => s.id === p.id)) onChange([...selected, p]);
    setQuery("");
  };
  return (
    <div className="user-picker">
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by username"
        aria-label="Search people to give access"
      />
      {debounced && (
        <ul className="picker-results">
          {results.loading ? (
            <li className="muted small">Searching…</li>
          ) : (results.data ?? []).length === 0 ? (
            <li className="muted small">No matching accounts.</li>
          ) : (
            results.data!.map((p) => (
              <li key={p.id}>
                <button type="button" className="picker-item" onClick={() => add(p)}>
                  <Avatar src={p.avatar_url} name={p.username} size={28} />
                  <span>
                    {p.display_name || p.username} <span className="muted">@{p.username}</span>
                  </span>
                  <UserPlus size={16} />
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {selected.length > 0 && (
        <ul className="chip-list">
          {selected.map((p) => (
            <li key={p.id} className="chip">
              @{p.username}
              <button type="button" aria-label={`Remove @${p.username}`} onClick={() => onChange(selected.filter((s) => s.id !== p.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Grant/revoke access for "selected users" videos and manage the unlisted share link. */
export function AccessManager({ videoId, visibility, ownerId }: { videoId: string; visibility: Visibility; ownerId: string }) {
  const toast = useToast();
  const access = useAsync(() => listVideoAccess(videoId), [videoId]);
  const shareKey = useAsync(() => getShareKey(videoId), [videoId]);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const results = useAsync(() => (debounced ? searchProfiles(debounced) : Promise.resolve([])), [debounced]);
  const [busy, setBusy] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [shareKey.data]);

  const grant = async (username: string) => {
    setBusy(true);
    try {
      await grantVideoAccess(videoId, username);
      toast.success(`@${username} can now watch this video`);
      setQuery("");
      access.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (userId: string, username: string) => {
    try {
      await revokeVideoAccess(videoId, userId);
      toast.success(`Removed @${username}'s access`);
      access.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const grants = (access.data ?? []).filter((a) => a.source === "grant");
  const linkViewers = (access.data ?? []).filter((a) => a.source === "link");
  const link = shareKey.data ? shareUrl(videoId, shareKey.data) : "";

  return (
    <div className="access-manager">
      {visibility === "unlisted" && (
        <section className="card-section">
          <h3>Secret link</h3>
          <p className="muted small">Anyone with this link can watch. Make a new link to stop the old one working.</p>
          {shareKey.loading ? (
            <Spinner />
          ) : (
            <div className="share-row">
              <input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Secret link" />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmRotate(true)}>
                <RefreshCw size={16} /> New link
              </button>
            </div>
          )}
          {linkViewers.length > 0 && (
            <p className="muted small">{linkViewers.length} signed-in people have opened the current link.</p>
          )}
        </section>
      )}

      <section className="card-section">
        <h3>People with access</h3>
        {visibility !== "selected" && visibility !== "unlisted" && (
          <p className="notice">
            {visibility === "private"
              ? "Private videos can only be watched by you and administrators, even if people are listed here."
              : "Public videos can be watched by everyone. This list only matters if you switch to “Selected users”."}
          </p>
        )}
        <form
          className="share-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) grant(query.trim().replace(/^@/, ""));
          }}
        >
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add by username"
            aria-label="Username to give access"
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()}>
            <UserPlus size={16} /> Give access
          </button>
        </form>
        {debounced && (results.data ?? []).length > 0 && (
          <ul className="picker-results">
            {results.data!
              .filter((p) => p.id !== ownerId)
              .map((p) => (
                <li key={p.id}>
                  <button type="button" className="picker-item" onClick={() => grant(p.username)}>
                    <Avatar src={p.avatar_url} name={p.username} size={28} />
                    <span>
                      {p.display_name || p.username} <span className="muted">@{p.username}</span>
                    </span>
                    <UserPlus size={16} />
                  </button>
                </li>
              ))}
          </ul>
        )}
        {access.error ? (
          <InlineError error={access.error} />
        ) : grants.length === 0 ? (
          <p className="muted small">Nobody has been given access yet.</p>
        ) : (
          <ul className="people-list">
            {grants.map((a) => (
              <li key={a.user_id}>
                <Avatar src={a.avatar_url} name={a.username} size={32} />
                <span className="people-name">
                  {a.display_name || a.username} <span className="muted">@{a.username}</span>
                  <span className="muted small">
                    Added {timeAgo(a.created_at)}
                    {a.granted_by_username ? ` by @${a.granted_by_username}` : ""}
                  </span>
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(a.user_id, a.username)}>
                  <Trash2 size={14} /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmRotate}
        title="Make a new link?"
        message="The current link will stop working, and people who opened it lose access."
        confirmLabel="Make new link"
        onClose={() => setConfirmRotate(false)}
        onConfirm={async () => {
          try {
            const key = await rotateShareKey(videoId);
            shareKey.setData(key);
            access.reload();
            toast.success("New link created");
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </div>
  );
}
