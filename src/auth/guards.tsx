import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ShieldAlert, Upload } from "lucide-react";
import { PageLoader } from "../components/Feedback";
import { useAuth } from "./AuthContext";

/** Sends signed-out visitors to the login page and brings them back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

/** Upload pages: creators with upload permission and administrators. The database enforces this too. */
export function RequireUploader({ children }: { children: ReactNode }) {
  const { canUpload, profile, loading, user } = useAuth();
  if (loading || (user && !profile)) return <PageLoader />;
  if (!canUpload) {
    return (
      <div className="page page-narrow">
        <div className="empty-state">
          <Upload size={40} aria-hidden />
          <h1>Uploading is for approved creators</h1>
          <p>
            {profile?.is_suspended
              ? "Your account is suspended, so you can't upload right now."
              : profile?.creator_status === "pending"
                ? "Your creator request is waiting for an administrator to review it."
                : "Ask to become a creator and an administrator will review your request."}
          </p>
          {!profile?.is_suspended && profile?.creator_status !== "pending" && (
            <Link className="btn btn-primary" to="/settings#creator">
              Request creator access
            </Link>
          )}
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading, profile, user } = useAuth();
  if (loading || (user && !profile)) return <PageLoader />;
  if (!isAdmin) {
    return (
      <div className="page page-narrow">
        <div className="empty-state">
          <ShieldAlert size={40} aria-hidden />
          <h1>Administrators only</h1>
          <p>You need an administrator account to open this page.</p>
          <Link className="btn btn-secondary" to="/">
            Go home
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
