// Every call to Supabase lives here. Authorization is enforced by the database (RLS and
// SECURITY DEFINER functions) and Edge Functions; the checks in the UI are only for convenience.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { absoluteUrl } from "../config/env";
import { db } from "./supabase";
import type {
  AccessEntry,
  AdminComment,
  AdminReport,
  AdminStats,
  AdminUser,
  Category,
  CommentRow,
  CreatorStats,
  ModerationStatus,
  NotificationRow,
  Playlist,
  Profile,
  ReportReason,
  ReportStatus,
  Role,
  VideoCard,
  VideoStatus,
  Visibility,
} from "./types";

function check<R extends { data: unknown; error: unknown }>(res: R): R["data"] {
  if (res.error) throw res.error;
  return res.data;
}

/** Calls an Edge Function and surfaces its JSON `error` message on failure. */
export async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await db().functions.invoke<T>(name, { body: body as Record<string, unknown> });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error ?? `The ${name} service failed (${error.context.status})`);
    }
    throw new Error(
      `Could not reach the ${name} service. Make sure the Edge Functions are deployed (see docs/SETUP.md).`,
    );
  }
  return data as T;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Escapes a value for PostgREST's or=(...) filter syntax. */
const orValue = (s: string) => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`;

async function currentUserId(): Promise<string> {
  const { data } = await db().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Please sign in first.");
  return id;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export async function signUp(input: { email: string; password: string; username: string; displayName: string }) {
  return check(
    await db().auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { username: input.username, display_name: input.displayName },
        emailRedirectTo: absoluteUrl("login?confirmed=1"),
      },
    }),
  );
}

export async function signIn(email: string, password: string) {
  return check(await db().auth.signInWithPassword({ email, password }));
}

export async function sendPasswordReset(email: string) {
  check(await db().auth.resetPasswordForEmail(email, { redirectTo: absoluteUrl("reset-password") }));
}

export async function updatePassword(password: string) {
  check(await db().auth.updateUser({ password }));
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const rows = check(await db().from("profiles").select("id").eq("username", username).limit(1));
  return (rows ?? []).length === 0;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export async function getProfileById(id: string): Promise<Profile | null> {
  return check(await db().from("profiles").select("*").eq("id", id).maybeSingle()) as Profile | null;
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  return check(
    await db().from("profiles").select("*").eq("username", username.toLowerCase()).maybeSingle(),
  ) as Profile | null;
}

export async function updateProfile(
  patch: Partial<Pick<Profile, "username" | "display_name" | "bio" | "website" | "avatar_url">>,
) {
  const id = await currentUserId();
  check(await db().from("profiles").update(patch).eq("id", id));
}

export async function uploadAvatar(file: File): Promise<string> {
  const id = await currentUserId();
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const path = `${id}/avatar-${Date.now()}.${ext}`;
  const bucket = db().storage.from("avatars");
  check(await bucket.upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" }));
  const url = bucket.getPublicUrl(path).data.publicUrl;
  await updateProfile({ avatar_url: url });
  // Remove older avatar files.
  const { data: files } = await bucket.list(id);
  const old = (files ?? []).map((f) => `${id}/${f.name}`).filter((p) => p !== path);
  if (old.length) await bucket.remove(old);
  return url;
}

export async function requestCreatorAccess(note: string) {
  check(await db().rpc("request_creator_access", { p_note: note }));
}

export async function searchProfiles(query: string): Promise<Profile[]> {
  return (check(await db().rpc("search_profiles", { p_query: query, p_limit: 12 })) ?? []) as Profile[];
}

// ---------------------------------------------------------------------------
// Videos: reading
// ---------------------------------------------------------------------------
/** Public, published, playable videos that have not been removed. */
const liveCards = () =>
  db()
    .from("video_cards")
    .select("*")
    .eq("visibility", "public")
    .eq("is_live", true)
    .eq("processing_status", "ready")
    .eq("moderation_status", "active");

export async function listFeed(opts: { offset: number; limit: number; ownerIds?: string[] }): Promise<VideoCard[]> {
  if (opts.ownerIds && opts.ownerIds.length === 0) return [];
  let q = liveCards();
  if (opts.ownerIds) q = q.in("owner_id", opts.ownerIds);
  const rows = check(
    await q
      .order("live_at", { ascending: false, nullsFirst: false })
      .order("id")
      .range(opts.offset, opts.offset + opts.limit - 1),
  );
  return (rows ?? []) as VideoCard[];
}

export async function getVideo(id: string, shareKey?: string | null): Promise<VideoCard | null> {
  const rows = check(await db().rpc("get_video", { p_video_id: id, p_share_key: shareKey ?? null })) as VideoCard[];
  return rows?.[0] ?? null;
}

export async function searchVideos(query: string, category: string | null, offset = 0): Promise<VideoCard[]> {
  return (check(
    await db().rpc("search_videos", { p_query: query, p_category: category, p_limit: 24, p_offset: offset }),
  ) ?? []) as VideoCard[];
}

export async function trendingHashtags(): Promise<{ tag: string; video_count: number }[]> {
  return (check(await db().rpc("trending_hashtags", { p_limit: 16 })) ?? []) as { tag: string; video_count: number }[];
}

let categoriesCache: Promise<Category[]> | null = null;
export function listCategories(): Promise<Category[]> {
  categoriesCache ??= (async () =>
    (check(await db().from("categories").select("*").order("sort_order")) ?? []) as Category[])().catch((e) => {
    categoriesCache = null;
    throw e;
  });
  return categoriesCache;
}

/** Public, live videos by one creator (what their profile shows to everyone). */
export async function listCreatorVideos(ownerId: string, offset = 0): Promise<VideoCard[]> {
  const rows = check(
    await liveCards()
      .eq("owner_id", ownerId)
      .order("live_at", { ascending: false })
      .range(offset, offset + 29),
  );
  return (rows ?? []) as VideoCard[];
}

/** Every video the signed-in user owns, in any state. */
export async function listMyVideos(): Promise<VideoCard[]> {
  const id = await currentUserId();
  const rows = check(
    await db().from("video_cards").select("*").eq("owner_id", id).order("created_at", { ascending: false }).limit(500),
  );
  return (rows ?? []) as VideoCard[];
}

async function cardsInOrder(ids: string[]): Promise<VideoCard[]> {
  if (ids.length === 0) return [];
  const rows = (check(await db().from("video_cards").select("*").in("id", ids)) ?? []) as VideoCard[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((v): v is VideoCard => !!v);
}

// ---------------------------------------------------------------------------
// Videos: creating and managing
// ---------------------------------------------------------------------------
export interface VideoInput {
  title: string;
  caption: string;
  hashtags: string[];
  category_slug: string | null;
  visibility: Visibility;
  status: VideoStatus;
  publish_at: string | null;
  allow_comments: boolean;
}

export async function createVideo(
  input: VideoInput & { original_filename?: string; size_bytes?: number },
): Promise<string> {
  const row = check(await db().from("videos").insert(input).select("id").single()) as { id: string };
  return row.id;
}

export async function updateVideo(id: string, patch: Partial<VideoInput> & { thumbnail_path?: string | null }) {
  const rows = check(await db().from("videos").update(patch).eq("id", id).select("id"));
  if (!rows || rows.length === 0) throw new Error("You don't have permission to edit this video.");
}

export async function uploadThumbnail(videoId: string, ownerId: string, file: Blob): Promise<string> {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ownerId}/${videoId}/thumb-${Date.now()}.${ext}`;
  const bucket = db().storage.from("thumbnails");
  check(await bucket.upload(path, file, { contentType: file.type || "image/jpeg", upsert: false }));
  await updateVideo(videoId, { thumbnail_path: path });
  const { data: files } = await bucket.list(`${ownerId}/${videoId}`);
  const old = (files ?? []).map((f) => `${ownerId}/${videoId}/${f.name}`).filter((p) => p !== path);
  if (old.length) await bucket.remove(old);
  return path;
}

export async function removeThumbnail(videoId: string, ownerId: string) {
  await updateVideo(videoId, { thumbnail_path: null });
  const bucket = db().storage.from("thumbnails");
  const { data: files } = await bucket.list(`${ownerId}/${videoId}`);
  if (files?.length) await bucket.remove(files.map((f) => `${ownerId}/${videoId}/${f.name}`));
}

export const requestUploadUrl = (videoId: string) =>
  invokeFunction<{ uploadUrl: string; uploadId: string }>("upload-url", { videoId });

export const refreshVideoStatus = (videoId: string) =>
  invokeFunction<{ status: string }>("video-status", { videoId });

export const deleteVideo = (videoId: string) => invokeFunction<{ deleted: boolean }>("delete-video", { videoId });

export async function getShareKey(videoId: string): Promise<string | null> {
  const row = check(await db().from("video_secrets").select("share_key").eq("video_id", videoId).maybeSingle()) as {
    share_key: string;
  } | null;
  return row?.share_key ?? null;
}

export async function rotateShareKey(videoId: string): Promise<string> {
  return check(await db().rpc("rotate_share_key", { p_video_id: videoId })) as string;
}

export async function listVideoAccess(videoId: string): Promise<AccessEntry[]> {
  return (check(await db().rpc("list_video_access", { p_video_id: videoId })) ?? []) as AccessEntry[];
}

export async function grantVideoAccess(videoId: string, username: string) {
  check(await db().rpc("grant_video_access", { p_video_id: videoId, p_username: username }));
}

export async function revokeVideoAccess(videoId: string, userId: string) {
  check(await db().rpc("revoke_video_access", { p_video_id: videoId, p_user_id: userId }));
}

export async function redeemShareLink(videoId: string, shareKey: string) {
  await db().rpc("redeem_share_link", { p_video_id: videoId, p_share_key: shareKey });
}

export function shareUrl(videoId: string, shareKey?: string | null) {
  return absoluteUrl(`v/${videoId}${shareKey ? `?k=${encodeURIComponent(shareKey)}` : ""}`);
}

export async function recordView(videoId: string, shareKey?: string | null) {
  await db().rpc("record_view", { p_video_id: videoId, p_share_key: shareKey ?? null });
}

export async function recordShare(videoId: string, shareKey?: string | null) {
  await db().rpc("record_share", { p_video_id: videoId, p_share_key: shareKey ?? null });
}

// ---------------------------------------------------------------------------
// Likes, saves, follows
// ---------------------------------------------------------------------------
export async function getViewerState(videoIds: string[]): Promise<{ liked: Set<string>; saved: Set<string> }> {
  const { data } = await db().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid || videoIds.length === 0) return { liked: new Set(), saved: new Set() };
  const [likes, saves] = await Promise.all([
    db().from("likes").select("video_id").eq("user_id", uid).in("video_id", videoIds),
    db().from("saved_videos").select("video_id").eq("user_id", uid).in("video_id", videoIds),
  ]);
  return {
    liked: new Set((check(likes) ?? []).map((r: { video_id: string }) => r.video_id)),
    saved: new Set((check(saves) ?? []).map((r: { video_id: string }) => r.video_id)),
  };
}

export async function setLiked(videoId: string, liked: boolean) {
  const uid = await currentUserId();
  if (liked) {
    const { error } = await db().from("likes").insert({ user_id: uid, video_id: videoId });
    if (error && error.code !== "23505") throw error; // already liked
  } else {
    check(await db().from("likes").delete().eq("user_id", uid).eq("video_id", videoId));
  }
}

export async function setSaved(videoId: string, saved: boolean) {
  const uid = await currentUserId();
  if (saved) {
    const { error } = await db().from("saved_videos").insert({ user_id: uid, video_id: videoId });
    if (error && error.code !== "23505") throw error;
  } else {
    check(await db().from("saved_videos").delete().eq("user_id", uid).eq("video_id", videoId));
  }
}

export async function getFollowingIds(): Promise<string[]> {
  const { data } = await db().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return [];
  const rows = check(await db().from("follows").select("following_id").eq("follower_id", uid).limit(1000));
  return (rows ?? []).map((r: { following_id: string }) => r.following_id);
}

export async function setFollowing(userId: string, follow: boolean) {
  const uid = await currentUserId();
  if (follow) {
    const { error } = await db().from("follows").insert({ follower_id: uid, following_id: userId });
    if (error && error.code !== "23505") throw error;
  } else {
    check(await db().from("follows").delete().eq("follower_id", uid).eq("following_id", userId));
  }
}

export async function listSaved(): Promise<VideoCard[]> {
  const uid = await currentUserId();
  const rows = check(
    await db().from("saved_videos").select("video_id").eq("user_id", uid).order("created_at", { ascending: false }).limit(200),
  );
  return cardsInOrder((rows ?? []).map((r: { video_id: string }) => r.video_id));
}

export async function listLiked(): Promise<VideoCard[]> {
  const uid = await currentUserId();
  const rows = check(
    await db().from("likes").select("video_id").eq("user_id", uid).order("created_at", { ascending: false }).limit(200),
  );
  return cardsInOrder((rows ?? []).map((r: { video_id: string }) => r.video_id));
}

// ---------------------------------------------------------------------------
// Comments and reports
// ---------------------------------------------------------------------------
export async function getComments(videoId: string, shareKey?: string | null): Promise<CommentRow[]> {
  return (check(
    await db().rpc("get_comments", { p_video_id: videoId, p_share_key: shareKey ?? null, p_limit: 200 }),
  ) ?? []) as CommentRow[];
}

export async function addComment(videoId: string, body: string, parentId: string | null) {
  check(await db().from("comments").insert({ video_id: videoId, body, parent_id: parentId }));
}

export async function deleteComment(id: string) {
  const rows = check(await db().from("comments").delete().eq("id", id).select("id"));
  if (!rows?.length) throw new Error("You can't delete this comment.");
}

/** Video owners hide comments with a direct update; administrators use the admin RPC. */
export async function setCommentHidden(id: string, hidden: boolean, asAdmin = false) {
  if (asAdmin) {
    check(await db().rpc("admin_set_comment_hidden", { p_comment_id: id, p_hidden: hidden }));
  } else {
    const rows = check(await db().from("comments").update({ is_hidden: hidden }).eq("id", id).select("id"));
    if (!rows?.length) throw new Error("You can't moderate this comment.");
  }
}

export async function submitReport(input: {
  videoId?: string | null;
  commentId?: string | null;
  reportedUserId?: string | null;
  reason: ReportReason;
  details: string;
}) {
  check(
    await db().from("reports").insert({
      video_id: input.videoId ?? null,
      comment_id: input.commentId ?? null,
      reported_user_id: input.reportedUserId ?? null,
      reason: input.reason,
      details: input.details,
    }),
  );
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------
type PlaylistRow = Omit<Playlist, "video_count"> & { playlist_videos: { count: number }[] };
const toPlaylist = (r: PlaylistRow): Playlist => ({ ...r, video_count: r.playlist_videos?.[0]?.count ?? 0 });

export async function listMyPlaylists(): Promise<Playlist[]> {
  const uid = await currentUserId();
  const rows = check(
    await db().from("playlists").select("*, playlist_videos(count)").eq("owner_id", uid).order("updated_at", { ascending: false }),
  );
  return ((rows ?? []) as PlaylistRow[]).map(toPlaylist);
}

export async function listPublicPlaylists(ownerId: string): Promise<Playlist[]> {
  const rows = check(
    await db()
      .from("playlists")
      .select("*, playlist_videos(count)")
      .eq("owner_id", ownerId)
      .eq("is_public", true)
      .order("updated_at", { ascending: false }),
  );
  return ((rows ?? []) as PlaylistRow[]).map(toPlaylist);
}

export async function getPlaylist(id: string): Promise<{ playlist: Playlist; videos: VideoCard[] } | null> {
  const row = check(await db().from("playlists").select("*, playlist_videos(count)").eq("id", id).maybeSingle()) as PlaylistRow | null;
  if (!row) return null;
  const items = check(
    await db().from("playlist_videos").select("video_id").eq("playlist_id", id).order("position").order("added_at"),
  );
  return { playlist: toPlaylist(row), videos: await cardsInOrder((items ?? []).map((r: { video_id: string }) => r.video_id)) };
}

export async function createPlaylist(title: string, description = "", isPublic = false): Promise<Playlist> {
  const row = check(
    await db().from("playlists").insert({ title, description, is_public: isPublic }).select("*, playlist_videos(count)").single(),
  ) as PlaylistRow;
  return toPlaylist(row);
}

export async function updatePlaylist(id: string, patch: { title?: string; description?: string; is_public?: boolean }) {
  check(await db().from("playlists").update(patch).eq("id", id));
}

export async function deletePlaylist(id: string) {
  check(await db().from("playlists").delete().eq("id", id));
}

export async function playlistsContaining(videoId: string): Promise<Set<string>> {
  const rows = check(await db().from("playlist_videos").select("playlist_id").eq("video_id", videoId));
  return new Set((rows ?? []).map((r: { playlist_id: string }) => r.playlist_id));
}

export async function setInPlaylist(playlistId: string, videoId: string, inPlaylist: boolean) {
  if (inPlaylist) {
    const { error } = await db().from("playlist_videos").insert({ playlist_id: playlistId, video_id: videoId, position: Date.now() % 2147483647 });
    if (error && error.code !== "23505") throw error;
  } else {
    check(await db().from("playlist_videos").delete().eq("playlist_id", playlistId).eq("video_id", videoId));
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export async function listNotifications(): Promise<NotificationRow[]> {
  const rows = check(
    await db()
      .from("notifications")
      .select("*, actor:profiles!notifications_actor_id_fkey(username, display_name, avatar_url), video:videos(title)")
      .order("created_at", { ascending: false })
      .limit(100),
  );
  return (rows ?? []) as NotificationRow[];
}

export async function unreadNotificationCount(): Promise<number> {
  const { count, error } = await db().from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationsRead(ids?: string[]) {
  let q = db().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (ids) q = q.in("id", ids);
  check(await q);
}

export async function deleteNotification(id: string) {
  check(await db().from("notifications").delete().eq("id", id));
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
export async function creatorStats(): Promise<CreatorStats> {
  return check(await db().rpc("creator_stats", { p_days: 14 })) as CreatorStats;
}

export async function adminStats(): Promise<AdminStats> {
  return check(await db().rpc("admin_stats")) as AdminStats;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
export async function adminListUsers(query: string, filter: string): Promise<AdminUser[]> {
  return (check(
    await db().rpc("admin_list_users", { p_query: query, p_filter: filter, p_limit: 100, p_offset: 0 }),
  ) ?? []) as AdminUser[];
}

export async function adminSetRole(userId: string, role: Role) {
  check(await db().rpc("admin_set_role", { p_user_id: userId, p_role: role }));
}

export async function adminSetUploadPermission(userId: string, allowed: boolean) {
  check(await db().rpc("admin_set_upload_permission", { p_user_id: userId, p_allowed: allowed }));
}

export async function adminReviewCreator(userId: string, approve: boolean, note = "") {
  check(await db().rpc("admin_review_creator", { p_user_id: userId, p_approve: approve, p_note: note }));
}

export const adminSetSuspension = (userId: string, suspend: boolean, reason = "") =>
  invokeFunction<{ ok: boolean; warning?: string }>("admin-users", {
    action: suspend ? "suspend" : "unsuspend",
    userId,
    reason,
  });

export async function adminListVideos(query: string, filter: string): Promise<VideoCard[]> {
  let q = db().from("video_cards").select("*");
  const text = query.trim();
  if (text) {
    const like = `%${escapeLike(text)}%`;
    q = q.or(`title.ilike.${orValue(like)},username.ilike.${orValue(like)},caption.ilike.${orValue(like)}`);
  }
  if (["public", "unlisted", "private", "selected"].includes(filter)) q = q.eq("visibility", filter);
  if (filter === "removed") q = q.eq("moderation_status", "removed");
  if (filter === "draft") q = q.eq("status", "draft");
  if (filter === "scheduled") q = q.eq("status", "scheduled");
  if (filter === "processing") q = q.in("processing_status", ["awaiting_upload", "processing"]);
  if (filter === "failed") q = q.eq("processing_status", "errored");
  const rows = check(await q.order("created_at", { ascending: false }).limit(100));
  return (rows ?? []) as VideoCard[];
}

export async function adminSetVideoModeration(videoId: string, status: ModerationStatus, reason = "") {
  check(await db().rpc("admin_set_video_moderation", { p_video_id: videoId, p_status: status, p_reason: reason }));
}

export async function adminListReports(status: ReportStatus | null): Promise<AdminReport[]> {
  return (check(await db().rpc("admin_list_reports", { p_status: status, p_limit: 200 })) ?? []) as AdminReport[];
}

export async function adminResolveReport(reportId: string, status: ReportStatus, note = "") {
  check(await db().rpc("admin_resolve_report", { p_report_id: reportId, p_status: status, p_note: note }));
}

export async function adminListComments(query: string): Promise<AdminComment[]> {
  let q = db()
    .from("comments")
    .select("id, body, is_hidden, created_at, video_id, author:profiles!comments_user_id_fkey(username), video:videos(title)");
  if (query.trim()) q = q.ilike("body", `%${escapeLike(query.trim())}%`);
  const rows = check(await q.order("created_at", { ascending: false }).limit(100));
  return (rows ?? []) as unknown as AdminComment[];
}

export async function adminDeleteComment(id: string) {
  await deleteComment(id);
}
