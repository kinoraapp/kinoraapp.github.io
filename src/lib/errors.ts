// Turns Supabase, Edge Function and network errors into messages people can act on.

const FRIENDLY: [RegExp, string][] = [
  [/Invalid login credentials/i, "That email and password don't match. Try again or reset your password."],
  [/Email not confirmed/i, "Please confirm your email first. Check your inbox for the link."],
  [/User already registered/i, "An account with this email already exists. Try signing in."],
  [/duplicate key value.*username/i, "That username is taken. Try another one."],
  [/profiles_username_check/i, "Usernames use 3–30 lowercase letters, numbers, dots or underscores."],
  [/row-level security|permission denied/i, "You don't have permission to do that."],
  [/JWT expired|session.*expired/i, "Your session expired. Please sign in again."],
  [/Failed to fetch|NetworkError|Load failed/i, "Can't reach the server. Check your connection and try again."],
  [/banned/i, "This account has been suspended."],
  [/rate limit/i, "Too many attempts. Please wait a moment and try again."],
];

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : typeof error === "string"
          ? error
          : "";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Reconnect and try again.";
  for (const [pattern, message] of FRIENDLY) if (pattern.test(raw)) return message;
  return raw || fallback;
}
