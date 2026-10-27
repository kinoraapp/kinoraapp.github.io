import { brand } from "./brand";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  /** False until real Supabase credentials are provided (the app then shows a setup screen). */
  configured:
    /^https?:\/\/\S+$/.test(supabaseUrl) && supabaseAnonKey.length > 20 && !supabaseUrl.includes("your-project-ref"),
  appName: import.meta.env.VITE_APP_NAME?.trim() || brand.name,
  maxUploadMb: Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 1024,
  maxVideoMinutes: Number(import.meta.env.VITE_MAX_VIDEO_MINUTES) || 10,
  /** "/" or "/<repo>/" (always ends with a slash). */
  basePath: import.meta.env.BASE_URL,
};

/** Absolute URL for an in-app path, respecting the GitHub Pages base path. */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${env.basePath}${path.replace(/^\/+/, "")}`;
}
