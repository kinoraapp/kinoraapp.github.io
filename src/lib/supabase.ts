import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

/** null until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set; the app shows a setup screen instead. */
export const supabase: SupabaseClient | null = env.configured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        // PKCE puts ?code=... in redirect URLs (email confirmation, password reset), which works
        // with client-side routing on GitHub Pages.
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function db(): SupabaseClient {
  if (!supabase) throw new Error("Supabase is not configured. Add your keys to .env.local (see README).");
  return supabase;
}
