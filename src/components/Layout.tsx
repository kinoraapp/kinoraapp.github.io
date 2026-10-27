import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  Bookmark,
  Clapperboard,
  Compass,
  Download,
  House,
  Inbox,
  LogIn,
  Settings,
  Shield,
  SquarePlus,
  User,
  WifiOff,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useInstallPrompt, useOnline } from "../hooks/useBrowser";
import { unreadNotificationCount } from "../lib/api";
import { supabase } from "../lib/supabase";
import { Avatar, Logo } from "./Brand";

/** Unread notification count, kept live with Supabase Realtime. */
function useUnreadCount(): number {
  const { user } = useAuth();
  const location = useLocation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user || !supabase) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const refresh = () =>
      unreadNotificationCount()
        .then((n) => !cancelled && setCount(n))
        .catch(() => undefined);
    refresh();
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        refresh,
      )
      .subscribe();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      supabase?.removeChannel(channel);
    };
  }, [user, location.pathname === "/inbox"]);

  return count;
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="nav-badge">{count > 99 ? "99+" : count}</span>;
}

function SideNav({ unread }: { unread: number }) {
  const { user, profile, isAdmin, canUpload } = useAuth();
  const install = useInstallPrompt();
  const item = (to: string, icon: ReactNode, label: string, badge?: number, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `side-link${isActive ? " active" : ""}`}>
      {icon}
      <span>{label}</span>
      {badge ? <NavBadge count={badge} /> : null}
    </NavLink>
  );
  return (
    <nav className="side-nav" aria-label="Main">
      <Link to="/" className="side-logo" aria-label="Home">
        <Logo size={34} />
      </Link>
      {item("/", <House size={22} />, "Home", 0, true)}
      {item("/explore", <Compass size={22} />, "Explore")}
      {item("/upload", <SquarePlus size={22} />, "Upload")}
      {user && item("/inbox", <Inbox size={22} />, "Inbox", unread)}
      {user && item("/library", <Bookmark size={22} />, "Library")}
      {canUpload && item("/studio", <Clapperboard size={22} />, "Creator studio")}
      {isAdmin && item("/admin", <Shield size={22} />, "Admin")}
      {user && item("/settings", <Settings size={22} />, "Settings")}
      <div className="side-spacer" />
      {install.canPrompt && (
        <button type="button" className="side-link" onClick={() => install.prompt()}>
          <Download size={22} />
          <span>Install app</span>
        </button>
      )}
      {user ? (
        profile && (
          <NavLink to={`/u/${profile.username}`} className={({ isActive }) => `side-link side-profile${isActive ? " active" : ""}`}>
            <Avatar src={profile.avatar_url} name={profile.username} size={28} />
            <span className="truncate">@{profile.username}</span>
          </NavLink>
        )
      ) : (
        <Link to="/login" className="btn btn-primary btn-block">
          <LogIn size={18} /> Log in
        </Link>
      )}
      <div className="side-legal">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
      </div>
    </nav>
  );
}

function BottomNav({ unread }: { unread: number }) {
  const { user, profile } = useAuth();
  const link = (to: string, icon: ReactNode, label: string, badge = 0, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `bottom-link${isActive ? " active" : ""}`}>
      <span className="bottom-icon">
        {icon}
        <NavBadge count={badge} />
      </span>
      <span>{label}</span>
    </NavLink>
  );
  return (
    <nav className="bottom-nav" aria-label="Main">
      {link("/", <House size={24} />, "Home", 0, true)}
      {link("/explore", <Compass size={24} />, "Explore")}
      <NavLink to="/upload" className="bottom-upload" aria-label="Upload">
        <SquarePlus size={26} />
      </NavLink>
      {link(user ? "/inbox" : "/login?next=%2Finbox", <Inbox size={24} />, "Inbox", unread)}
      {link(user && profile ? `/u/${profile.username}` : "/login", <User size={24} />, "Profile")}
    </nav>
  );
}

function Banners() {
  const online = useOnline();
  const { profile } = useAuth();
  const install = useInstallPrompt();
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      return localStorage.getItem("install-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const dismissInstall = () => {
    setInstallDismissed(true);
    try {
      localStorage.setItem("install-dismissed", "1");
    } catch {
      // ignore
    }
  };

  return (
    <div className="banners">
      {!online && (
        <div className="banner banner-warning" role="status">
          <WifiOff size={16} /> You're offline. Videos and updates need a connection.
        </div>
      )}
      {profile?.is_suspended && (
        <div className="banner banner-danger" role="status">
          Your account is suspended{profile.suspended_reason ? `: ${profile.suspended_reason}` : ""}. You can watch public
          videos but can't post, comment or like.
        </div>
      )}
      {needRefresh && (
        <div className="banner banner-info" role="status">
          A new version is available.
          <button type="button" className="btn btn-sm btn-primary" onClick={() => updateServiceWorker(true)}>
            Update
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNeedRefresh(false)}>
            <X size={16} />
          </button>
        </div>
      )}
      {install.canPrompt && !installDismissed && (
        <div className="banner banner-install mobile-only" role="status">
          <Download size={16} /> Install the app for full-screen viewing.
          <button type="button" className="btn btn-sm btn-primary" onClick={() => install.prompt()}>
            Install
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismissInstall}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const unread = useUnreadCount();
  const location = useLocation();
  const immersive = location.pathname === "/";
  return (
    <div className={`app-shell${immersive ? " immersive" : ""}`}>
      <SideNav unread={unread} />
      <main className="main" id="main">
        <Banners />
        <Outlet />
      </main>
      <BottomNav unread={unread} />
    </div>
  );
}
