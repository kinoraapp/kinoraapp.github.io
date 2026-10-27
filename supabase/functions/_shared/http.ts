// CORS and JSON helpers shared by every function.

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

/** The request's Origin if it is allowed (or any origin when ALLOWED_ORIGINS is not set). */
export function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin")?.replace(/\/+$/, "") ?? null;
  if (allowedOrigins.length === 0) return origin ?? "*";
  if (origin && allowedOrigins.includes(origin)) return origin;
  return null;
}

/** Origin Mux should accept browser uploads from. */
export function uploadOrigin(req: Request): string {
  return allowedOrigin(req) ?? allowedOrigins[0] ?? "*";
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req) ?? allowedOrigins[0] ?? "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Wraps a handler with CORS preflight handling, POST-only enforcement and error responses. */
export function handle(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    if (req.headers.get("Origin") && allowedOrigin(req) === null) {
      return json(req, { error: "Origin not allowed" }, 403);
    }
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof HttpError) return json(req, { error: error.message }, error.status);
      console.error(error);
      return json(req, { error: "Something went wrong. Please try again." }, 500);
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(value: unknown, name = "id"): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, `Invalid ${name}`);
  return value;
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `Server is missing the ${name} setting`);
  return value;
}
