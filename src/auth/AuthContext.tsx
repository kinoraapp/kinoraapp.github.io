import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getProfileById } from "../lib/api";
import { clearPlaybackCache } from "../lib/playback";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** True until the first session check has finished. */
  loading: boolean;
  /** Set when the user arrived from a password-reset email link. */
  recovering: boolean;
  isAdmin: boolean;
  canUpload: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const userId = session?.user.id ?? null;

  const loadProfile = useCallback(async (id: string | null) => {
    if (!id) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await getProfileById(id));
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      loadProfile(data.session?.user.id ?? null).finally(() => mounted && setLoading(false));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") clearPlaybackCache();
      setSession(next);
      // Supabase advises against awaiting other Supabase calls inside this callback.
      setTimeout(() => loadProfile(next?.user.id ?? null), 0);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(() => loadProfile(userId), [loadProfile, userId]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    clearPlaybackCache();
    setProfile(null);
    setRecovering(false);
  }, []);

  const value = useMemo<AuthState>(() => {
    const active = !!profile && !profile.is_suspended;
    return {
      session,
      user: session?.user ?? null,
      profile,
      loading,
      recovering,
      isAdmin: active && profile!.role === "admin",
      canUpload: active && (profile!.role === "admin" || (profile!.role === "creator" && profile!.can_upload)),
      refreshProfile,
      signOut,
    };
  }, [session, profile, loading, recovering, refreshProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
