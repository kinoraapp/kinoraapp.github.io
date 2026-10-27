import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Logo } from "../components/Brand";
import { InlineError } from "../components/Feedback";
import { useToast } from "../components/Toast";
import { isUsernameAvailable, sendPasswordReset, signIn, signUp, updatePassword } from "../lib/api";
import { env } from "../config/env";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-z0-9_.]{3,30}$/;

/** Only allow in-app redirects after sign-in (no open redirects). */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-logo" aria-label="Home">
          <Logo size={40} />
        </Link>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  autoComplete,
  label = "Password",
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  label?: string;
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span className="label">{label}</span>
      <span className="input-with-btn">
        <input
          className="input"
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          minLength={8}
          aria-invalid={invalid}
        />
        <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) return setError(new Error("Enter a valid email address."));
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Log in"
      subtitle={params.get("confirmed") ? "Your email is confirmed. Log in to get started." : `Welcome back to ${env.appName}.`}
      footer={
        <>
          New here? <Link to={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="field-row-end">
          <Link to="/forgot-password" className="small">
            Forgot password?
          </Link>
        </div>
        <InlineError error={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState({ username: "", displayName: "", email: "", password: "", confirm: "", terms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const username = form.username.trim().toLowerCase();
    const errs: Record<string, string> = {};
    if (!USERNAME.test(username)) errs.username = "Use 3–30 lowercase letters, numbers, dots or underscores.";
    if (form.displayName.trim().length > 60) errs.displayName = "Keep it under 60 characters.";
    if (!EMAIL.test(form.email.trim())) errs.email = "Enter a valid email address.";
    if (form.password.length < 8) errs.password = "Use at least 8 characters.";
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) errs.password = "Use both letters and numbers.";
    if (form.confirm !== form.password) errs.confirm = "Passwords don't match.";
    if (!form.terms) errs.terms = "Please accept the terms to continue.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError(null);
    try {
      if (!(await isUsernameAvailable(username))) {
        setErrors({ username: "That username is taken." });
        return;
      }
      const result = await signUp({
        email: form.email.trim(),
        password: form.password,
        username,
        displayName: form.displayName.trim() || username,
      });
      if (result.session) navigate(next, { replace: true });
      else setSentTo(form.email.trim());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthCard title="Check your email" footer={<Link to="/login">Back to log in</Link>}>
        <div className="empty-state compact">
          <MailCheck size={40} />
          <p>
            We sent a confirmation link to <strong>{sentTo}</strong>. Open it on this device to finish creating your account.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" subtitle="Watch, share and follow creators." footer={<>Already have an account? <Link to="/login">Log in</Link></>}>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="label">Username</span>
          <span className="input-prefix">
            <span>@</span>
            <input
              className="input"
              value={form.username}
              onChange={(e) => set({ username: e.target.value.toLowerCase().replace(/\s/g, "") })}
              autoComplete="username"
              maxLength={30}
              required
              aria-invalid={!!errors.username}
            />
          </span>
          {errors.username && <span className="field-error">{errors.username}</span>}
        </label>
        <label className="field">
          <span className="label">Display name</span>
          <input className="input" value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} maxLength={60} autoComplete="name" />
          {errors.displayName && <span className="field-error">{errors.displayName}</span>}
        </label>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" required aria-invalid={!!errors.email} />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </label>
        <PasswordInput value={form.password} onChange={(v) => set({ password: v })} autoComplete="new-password" invalid={!!errors.password} />
        {errors.password && <span className="field-error">{errors.password}</span>}
        <PasswordInput value={form.confirm} onChange={(v) => set({ confirm: v })} autoComplete="new-password" label="Confirm password" invalid={!!errors.confirm} />
        {errors.confirm && <span className="field-error">{errors.confirm}</span>}
        <label className="check-row">
          <input type="checkbox" checked={form.terms} onChange={(e) => set({ terms: e.target.checked })} />
          <span>
            I agree to the <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>.
          </span>
        </label>
        {errors.terms && <span className="field-error">{errors.terms}</span>}
        <InlineError error={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) return setError(new Error("Enter a valid email address."));
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Reset your password" footer={<Link to="/login">Back to log in</Link>}>
      {sent ? (
        <div className="empty-state compact">
          <MailCheck size={40} />
          <p>If an account exists for {email}, you'll get an email with a link to choose a new password.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="muted">Enter your email and we'll send you a reset link.</p>
          <label className="field">
            <span className="label">Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <InlineError error={error} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError(new Error("Use at least 8 characters."));
    if (password !== confirm) return setError(new Error("Passwords don't match."));
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      toast.success("Password updated");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!loading && !user) {
    return (
      <AuthCard title="Link expired" footer={<Link to="/forgot-password">Send a new link</Link>}>
        <p className="muted">This reset link is invalid or has expired, or it was opened in a different browser. Request a new one.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} noValidate>
        <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" label="New password" />
        <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" label="Confirm new password" />
        <InlineError error={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || loading}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </AuthCard>
  );
}
