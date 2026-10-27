// Supabase clients for Edge Functions.
// - The caller's client acts as the person making the request, so Row Level Security applies.
// - serviceClient bypasses RLS; it is only used after the caller's rights have been checked.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { HttpError, requireEnv } from "./http.ts";

const url = () => requireEnv("SUPABASE_URL");
const anonKey = () => Deno.env.get("SUPABASE_ANON_KEY") ?? requireEnv("SUPABASE_PUBLISHABLE_KEY");
const serviceKey = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? requireEnv("SUPABASE_SECRET_KEY");

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function serviceClient(): SupabaseClient {
  return createClient(url(), serviceKey(), { auth: noSession });
}

export interface Caller {
  user: User | null;
  client: SupabaseClient;
}

/** Identifies the caller from the Authorization header. Signed-out callers get an anonymous client. */
export async function getCaller(req: Request): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token.split(".").length === 3) {
    const client = createClient(url(), anonKey(), {
      auth: noSession,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    // The legacy anon key is also a JWT; getUser fails for it, so it falls through to anonymous.
    const { data, error } = await client.auth.getUser(token);
    if (!error && data.user) return { user: data.user, client };
  }
  return { user: null, client: createClient(url(), anonKey(), { auth: noSession }) };
}

export async function requireUser(req: Request): Promise<Caller & { user: User }> {
  const caller = await getCaller(req);
  if (!caller.user) throw new HttpError(401, "Please sign in");
  return caller as Caller & { user: User };
}
