import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { errorMessage } from "../lib/errors";
import { useOnline } from "../hooks/useBrowser";

export function Spinner({ size = 28, label = "Loading" }: { size?: number; label?: string }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label={label} />;
}

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="page-loader">
      <Spinner size={36} label={label} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const online = useOnline();
  return (
    <div className="empty-state" role="alert">
      {online ? <AlertTriangle size={36} aria-hidden /> : <WifiOff size={36} aria-hidden />}
      <h2>{title ?? (online ? "Couldn't load this" : "You're offline")}</h2>
      <p>{online ? errorMessage(error) : "Connect to the internet to see videos and updates."}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="form-error" role="alert">
      {errorMessage(error)}
    </p>
  );
}
