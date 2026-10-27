// Minimal Deno globals so `npm run typecheck` can type-check the Edge Functions with Node's TypeScript.
// Supabase runs them on Deno, where these come from the runtime.
declare namespace Deno {
  const env: { get(name: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
