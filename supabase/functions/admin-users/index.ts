// POST { action: "suspend" | "unsuspend", userId, reason? }
// Suspends or reinstates an account: the database flag (checked by RLS and admin_set_suspension,
// which verifies the caller is an administrator) plus a ban in Supabase Auth so the person
// cannot sign in or refresh their session.
import { assertUuid, handle, HttpError, json, readJson } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";

Deno.serve(
  handle(async (req) => {
    const { client } = await requireUser(req);
    const body = await readJson<{ action?: unknown; userId?: unknown; reason?: unknown }>(req);
    const userId = assertUuid(body.userId, "user id");
    if (body.action !== "suspend" && body.action !== "unsuspend") throw new HttpError(400, "Unknown action");
    const suspend = body.action === "suspend";
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : "";

    // Runs as the caller: fails unless they are an administrator.
    const { error } = await client.rpc("admin_set_suspension", {
      p_user_id: userId,
      p_suspended: suspend,
      p_reason: reason,
    });
    if (error) throw new HttpError(error.code === "42501" ? 403 : 400, error.message);

    const { error: banError } = await serviceClient().auth.admin.updateUserById(userId, {
      ban_duration: suspend ? "876000h" : "none",
    });
    if (banError) {
      console.error("Auth ban update failed", banError);
      return json(req, { ok: true, warning: "Account flag updated, but sign-in could not be blocked" });
    }
    return json(req, { ok: true });
  }),
);
