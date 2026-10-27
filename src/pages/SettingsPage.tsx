import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Camera, Clapperboard, Download, KeyRound, LogOut, Save, Share, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Brand";
import { InlineError, PageLoader } from "../components/Feedback";
import { useToast } from "../components/Toast";
import { useInstallPrompt } from "../hooks/useBrowser";
import { isUsernameAvailable, requestCreatorAccess, updatePassword, updateProfile, uploadAvatar } from "../lib/api";
import { env } from "../config/env";

function ProfileSection() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ username: "", display_name: "", bio: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({ username: profile.username, display_name: profile.display_name, bio: profile.bio, website: profile.website ?? "" });
    }
  }, [profile]);

  if (!profile) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const username = form.username.trim().toLowerCase();
    const errs: Record<string, string> = {};
    if (!/^[a-z0-9_.]{3,30}$/.test(username)) errs.username = "Use 3–30 lowercase letters, numbers, dots or underscores.";
    if (form.website.trim() && !/^https?:\/\/\S+$/i.test(form.website.trim())) errs.website = "Start the link with https://";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      if (username !== profile.username && !(await isUsernameAvailable(username))) {
        setErrors({ username: "That username is taken." });
        return;
      }
      await updateProfile({
        username,
        display_name: form.display_name.trim(),
        bio: form.bio.trim(),
        website: form.website.trim() || null,
      });
      await refreshProfile();
      toast.success("Profile saved");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return toast.error("Use a JPG, PNG, WebP or GIF image.");
    if (file.size > 2 * 1024 * 1024) return toast.error("Profile pictures can be up to 2 MB.");
    setAvatarBusy(true);
    try {
      await uploadAvatar(file);
      await refreshProfile();
      toast.success("Profile picture updated");
    } catch (err) {
      toast.error(err);
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <section className="card" id="profile">
      <h2 className="card-title">Profile</h2>
      <div className="avatar-edit">
        <Avatar src={profile.avatar_url} name={profile.username} size={80} />
        <label className={`btn btn-secondary btn-sm${avatarBusy ? " disabled" : ""}`}>
          <Camera size={14} /> {avatarBusy ? "Uploading…" : "Change photo"}
          <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,image/gif" disabled={avatarBusy} onChange={(e) => changeAvatar(e.target.files?.[0])} />
        </label>
      </div>
      <form onSubmit={save} noValidate>
        <label className="field">
          <span className="label">Username</span>
          <span className="input-prefix">
            <span>@</span>
            <input className="input" value={form.username} maxLength={30} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
          </span>
          {errors.username && <span className="field-error">{errors.username}</span>}
        </label>
        <label className="field">
          <span className="label">Display name</span>
          <input className="input" value={form.display_name} maxLength={60} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">
            Bio <span className="muted small">{form.bio.length}/300</span>
          </span>
          <textarea className="input" rows={3} maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Website</span>
          <input className="input" type="url" value={form.website} placeholder="https://" onChange={(e) => setForm({ ...form, website: e.target.value })} />
          {errors.website && <span className="field-error">{errors.website}</span>}
        </label>
        <InlineError error={error} />
        <div className="button-row end">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Save size={16} /> {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </section>
  );
}

function CreatorSection() {
  const { profile, refreshProfile, canUpload } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!profile) return null;

  let body;
  if (canUpload) {
    body = (
      <>
        <p>
          <ShieldCheck size={16} className="text-success" /> You can upload videos.
        </p>
        <div className="button-row">
          <Link to="/upload" className="btn btn-primary">
            Upload a video
          </Link>
          <Link to="/studio" className="btn btn-secondary">
            Creator studio
          </Link>
        </div>
      </>
    );
  } else if (profile.role === "creator" && !profile.can_upload) {
    body = <p className="muted">An administrator has paused uploads for your account.</p>;
  } else if (profile.creator_status === "pending") {
    body = <p className="muted">Your request is waiting for review. You'll get a notification when it's decided.</p>;
  } else {
    body = (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await requestCreatorAccess(note.trim());
            await refreshProfile();
            toast.success("Request sent to the administrators");
          } catch (err) {
            toast.error(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {profile.creator_status === "rejected" && <p className="notice">Your last request wasn't approved. You can apply again.</p>}
        <p className="muted">Creators can upload videos. Tell the administrators a little about what you'd like to post.</p>
        <label className="field">
          <span className="label">About your content (optional)</span>
          <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || profile.is_suspended}>
          <Clapperboard size={16} /> {busy ? "Sending…" : "Request creator access"}
        </button>
      </form>
    );
  }

  return (
    <section className="card" id="creator">
      <h2 className="card-title">Creator access</h2>
      {body}
    </section>
  );
}

function AccountSection() {
  const { user, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="card" id="account">
      <h2 className="card-title">Account</h2>
      <p>
        <span className="label">Email</span>
        <br />
        {user?.email}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (password.length < 8) return setError(new Error("Use at least 8 characters."));
          if (password !== confirm) return setError(new Error("Passwords don't match."));
          setBusy(true);
          try {
            await updatePassword(password);
            setPassword("");
            setConfirm("");
            toast.success("Password changed");
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field-row">
          <label className="field">
            <span className="label">New password</span>
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Confirm</span>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
        </div>
        <InlineError error={error} />
        <div className="button-row">
          <button type="submit" className="btn btn-secondary" disabled={busy || !password}>
            <KeyRound size={16} /> Change password
          </button>
          <button
            type="button"
            className="btn btn-ghost danger"
            onClick={async () => {
              await signOut();
              navigate("/", { replace: true });
            }}
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      </form>
    </section>
  );
}

function AppSection() {
  const install = useInstallPrompt();
  return (
    <section className="card" id="app">
      <h2 className="card-title">App</h2>
      {install.installed ? (
        <p className="muted">You're using the installed app.</p>
      ) : install.canPrompt ? (
        <button type="button" className="btn btn-secondary" onClick={() => install.prompt()}>
          <Download size={16} /> Install {env.appName}
        </button>
      ) : install.iosHint ? (
        <p className="muted">
          To install on iPhone or iPad: tap <Share size={14} aria-label="Share" /> Share in Safari, then “Add to Home Screen”.
        </p>
      ) : (
        <p className="muted">
          You can install {env.appName} from your browser menu (look for “Install app” or “Add to Home screen”). It works in the browser
          too, no download needed.
        </p>
      )}
      <p className="muted small">
        <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link>
      </p>
    </section>
  );
}

export default function SettingsPage() {
  const { profile, loading } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash, profile]);
  if (loading || !profile) return <PageLoader />;
  return (
    <div className="page page-narrow settings">
      <h1 className="page-title">Settings</h1>
      <ProfileSection />
      <CreatorSection />
      <AccountSection />
      <AppSection />
    </div>
  );
}
