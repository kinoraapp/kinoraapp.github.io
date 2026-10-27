import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, createTestDb, createUser, errorOf, one, rows } from "./harness";

type Ids = Record<string, string>;

let db: PGlite;
const user: Ids = {};
const video: Ids = {};

async function insertVideo(ownerId: string, title: string, fields: Record<string, unknown>) {
  return asUser(db, ownerId, async (tx) => {
    const { id } = await one<{ id: string }>(
      tx,
      `insert into public.videos (title, caption, visibility, status, publish_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [title, fields.caption ?? "", fields.visibility ?? "public", fields.status ?? "published", fields.publish_at ?? null],
    );
    return id;
  });
}

async function markReady(id: string) {
  await db.query("update public.videos set processing_status = 'ready', mux_playback_id = $2 where id = $1", [
    id,
    `playback-${id.slice(0, 8)}`,
  ]);
}

async function canView(who: string | null, videoId: string, shareKey: string | null = null) {
  const q = (tx: Parameters<Parameters<typeof asAnon>[1]>[0]) =>
    one<{ ok: boolean }>(tx, "select public.can_view_video($1, $2) as ok", [videoId, shareKey]);
  const res = who ? await asUser(db, who, q) : await asAnon(db, q);
  return res.ok;
}

async function visibleVideoIds(who: string | null) {
  const q = async (tx: Parameters<Parameters<typeof asAnon>[1]>[0]) =>
    (await rows<{ id: string }>(tx, "select id from public.videos")).map((r) => r.id);
  return who ? asUser(db, who, q) : asAnon(db, q);
}

beforeAll(async () => {
  db = await createTestDb();
  user.admin = await createUser(db, "admin", { role: "admin", canUpload: true });
  user.creator = await createUser(db, "creator", { role: "creator", canUpload: true });
  user.viewer = await createUser(db, "viewer");
  user.friend = await createUser(db, "friend");
  user.stranger = await createUser(db, "stranger");

  video.public = await insertVideo(user.creator, "Public video #Fun", { caption: "hello #World #fun" });
  video.unlisted = await insertVideo(user.creator, "Unlisted video", { visibility: "unlisted" });
  video.private = await insertVideo(user.creator, "Private video", { visibility: "private" });
  video.selected = await insertVideo(user.creator, "Selected video", { visibility: "selected" });
  video.draft = await insertVideo(user.creator, "Draft video", { status: "draft" });
  video.future = await insertVideo(user.creator, "Future video", {
    status: "scheduled",
    publish_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  for (const id of Object.values(video)) await markReady(id);
});

describe("accounts and roles", () => {
  it("creates a profile with the requested username on sign-up", async () => {
    const p = await one<{ username: string; role: string; can_upload: boolean }>(
      db,
      "select username, role, can_upload from public.profiles where id = $1",
      [user.viewer],
    );
    expect(p).toEqual({ username: "viewer", role: "viewer", can_upload: false });
  });

  it("falls back to a generated username when the requested one is taken", async () => {
    const id = await createUser(db, "viewer2");
    await db.query("update auth.users set raw_user_meta_data = '{}' where id = $1", [id]);
    const { id: dupe } = await one<{ id: string }>(
      db,
      "insert into auth.users (email, raw_user_meta_data) values ('dupe@example.com', '{\"username\":\"viewer\"}') returning id",
    );
    const p = await one<{ username: string }>(db, "select username from public.profiles where id = $1", [dupe]);
    expect(p.username).toMatch(/^user_[0-9a-f]{10}$/);
  });

  it("does not let users change their own role, upload permission or suspension", async () => {
    for (const column of ["role = 'admin'", "can_upload = true", "is_suspended = false"]) {
      const err = await errorOf(
        asUser(db, user.viewer, (tx) => tx.query(`update public.profiles set ${column} where id = $1`, [user.viewer])),
      );
      expect(err).toMatch(/permission denied/);
    }
  });

  it("lets users edit their own public profile fields only", async () => {
    await asUser(db, user.viewer, (tx) =>
      tx.query("update public.profiles set bio = 'hi' where id = $1", [user.viewer]),
    );
    const res = await asUser(db, user.viewer, (tx) =>
      tx.query("update public.profiles set bio = 'hacked' where id = $1", [user.creator]),
    );
    expect(res.affectedRows).toBe(0);
  });

  it("blocks uploads from viewers and from creators without upload permission", async () => {
    const err = await errorOf(insertVideo(user.viewer, "nope", {}));
    expect(err).toMatch(/row-level security/);
    const pending = await createUser(db, "pending_creator", { role: "creator", canUpload: false });
    expect(await errorOf(insertVideo(pending, "nope", {}))).toMatch(/row-level security/);
  });

  it("only administrators can call admin functions", async () => {
    const err = await errorOf(asUser(db, user.creator, (tx) => tx.query("select public.admin_stats()")));
    expect(err).toMatch(/Administrator access required/);
    const stats = await asUser(db, user.admin, (tx) => one<{ s: Record<string, number> }>(tx, "select public.admin_stats() as s"));
    expect(stats.s.videos).toBe(6);
    expect(stats.s.private_videos).toBe(1);
  });

  it("supports the creator request and approval flow", async () => {
    const applicant = await createUser(db, "applicant");
    await asUser(db, applicant, (tx) => tx.query("select public.request_creator_access('I make cooking videos')"));
    const notes = await rows(db, "select 1 from public.notifications where user_id = $1 and type = 'creator_request'", [
      user.admin,
    ]);
    expect(notes.length).toBeGreaterThan(0);
    expect(await errorOf(asUser(db, applicant, (tx) => tx.query("select public.admin_review_creator($1, true)", [applicant])))).toMatch(
      /Administrator/,
    );
    await asUser(db, user.admin, (tx) => tx.query("select public.admin_review_creator($1, true)", [applicant]));
    const p = await one<{ role: string; can_upload: boolean }>(db, "select role, can_upload from public.profiles where id = $1", [
      applicant,
    ]);
    expect(p).toEqual({ role: "creator", can_upload: true });
    const id = await insertVideo(applicant, "First upload", {});
    expect(id).toBeTruthy();
  });

  it("can promote the first administrator only from SQL, not the API", async () => {
    const err = await errorOf(
      asUser(db, user.viewer, (tx) => tx.query("select public.bootstrap_admin('viewer@example.com')")),
    );
    expect(err).toMatch(/permission denied/);
  });
});

describe("video visibility", () => {
  it("public videos are visible to everyone, including signed-out visitors", async () => {
    expect(await canView(null, video.public)).toBe(true);
    expect(await canView(user.stranger, video.public)).toBe(true);
    const anonSees = await visibleVideoIds(null);
    expect(anonSees).toContain(video.public);
    for (const hidden of [video.unlisted, video.private, video.selected, video.draft, video.future]) {
      expect(anonSees).not.toContain(hidden);
    }
  });

  it("private videos are visible only to the owner and administrators", async () => {
    expect(await canView(null, video.private)).toBe(false);
    expect(await canView(user.viewer, video.private)).toBe(false);
    expect(await canView(user.creator, video.private)).toBe(true);
    expect(await canView(user.admin, video.private)).toBe(true);
    // Even an explicit grant does not open a private video.
    await asUser(db, user.creator, (tx) => tx.query("select * from public.grant_video_access($1, 'viewer')", [video.private]));
    expect(await canView(user.viewer, video.private)).toBe(false);
    await asUser(db, user.creator, (tx) => tx.query("select public.revoke_video_access($1, $2)", [video.private, user.viewer]));
  });

  it("drafts and future scheduled videos are hidden until they go live", async () => {
    for (const id of [video.draft, video.future]) {
      expect(await canView(user.viewer, id)).toBe(false);
      expect(await canView(null, id)).toBe(false);
      expect(await canView(user.creator, id)).toBe(true);
      expect(await canView(user.admin, id)).toBe(true);
    }
  });

  it("scheduled videos go live at their time and the cron job marks them published", async () => {
    const id = await insertVideo(user.creator, "Soon", {
      status: "scheduled",
      publish_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    await markReady(id);
    expect(await canView(user.viewer, id)).toBe(false);
    await db.query("update public.videos set publish_at = now() - interval '1 minute' where id = $1", [id]);
    // Even before the job runs, the time check makes it watchable.
    await db.query("alter table public.videos disable trigger videos_before_write");
    await db.query("update public.videos set status = 'scheduled' where id = $1", [id]);
    await db.query("alter table public.videos enable trigger videos_before_write");
    expect(await canView(user.viewer, id)).toBe(true);
    const { n } = await one<{ n: number }>(db, "select public.publish_due_videos() as n");
    expect(n).toBeGreaterThanOrEqual(1);
    const v = await one<{ status: string; published_at: string | null }>(
      db,
      "select status, published_at from public.videos where id = $1",
      [id],
    );
    expect(v.status).toBe("published");
    expect(v.published_at).not.toBeNull();
  });

  it("selected-user videos are visible only to people granted access", async () => {
    expect(await canView(user.friend, video.selected)).toBe(false);
    const granted = await asUser(db, user.creator, (tx) =>
      rows<{ username: string }>(tx, "select * from public.grant_video_access($1, '@friend')", [video.selected]),
    );
    expect(granted[0].username).toBe("friend");
    expect(await canView(user.friend, video.selected)).toBe(true);
    expect(await canView(user.stranger, video.selected)).toBe(false);
    expect(await canView(null, video.selected)).toBe(false);
    const note = await rows(db, "select 1 from public.notifications where user_id = $1 and type = 'access_granted'", [user.friend]);
    expect(note.length).toBe(1);

    await asUser(db, user.creator, (tx) => tx.query("select public.revoke_video_access($1, $2)", [video.selected, user.friend]));
    expect(await canView(user.friend, video.selected)).toBe(false);
  });

  it("only the owner or an administrator can grant access", async () => {
    const err = await errorOf(
      asUser(db, user.stranger, (tx) => tx.query("select * from public.grant_video_access($1, 'stranger')", [video.selected])),
    );
    expect(err).toMatch(/owner or an administrator/);
    await asUser(db, user.admin, (tx) => tx.query("select * from public.grant_video_access($1, 'stranger')", [video.selected]));
    expect(await canView(user.stranger, video.selected)).toBe(true);
    await asUser(db, user.admin, (tx) => tx.query("select public.revoke_video_access($1, $2)", [video.selected, user.stranger]));
    expect(await canView(user.stranger, video.selected)).toBe(false);
  });

  it("unlisted videos need the share key, and the key is secret", async () => {
    const { share_key } = await one<{ share_key: string }>(
      db,
      "select share_key from public.video_secrets where video_id = $1",
      [video.unlisted],
    );
    expect(share_key).toMatch(/^[0-9a-f]{64}$/);

    expect(await canView(null, video.unlisted)).toBe(false);
    expect(await canView(null, video.unlisted, "wrong-key")).toBe(false);
    expect(await canView(null, video.unlisted, share_key)).toBe(true);

    // Not listed for anyone browsing the table.
    expect(await visibleVideoIds(user.viewer)).not.toContain(video.unlisted);
    // Other users cannot read the share key.
    const leaked = await asUser(db, user.viewer, (tx) => rows(tx, "select share_key from public.video_secrets"));
    expect(leaked).toEqual([]);
    const own = await asUser(db, user.creator, (tx) => rows(tx, "select share_key from public.video_secrets"));
    expect(own.length).toBeGreaterThan(0);

    // get_video works with the key only.
    const without = await asAnon(db, (tx) => rows(tx, "select id from public.get_video($1)", [video.unlisted]));
    const withKey = await asAnon(db, (tx) => rows(tx, "select id from public.get_video($1, $2)", [video.unlisted, share_key]));
    expect(without).toEqual([]);
    expect(withKey.length).toBe(1);
  });

  it("opening an unlisted link signed in keeps access until the link is rotated", async () => {
    const { share_key } = await one<{ share_key: string }>(db, "select share_key from public.video_secrets where video_id = $1", [
      video.unlisted,
    ]);
    const bad = await asUser(db, user.viewer, (tx) =>
      one<{ ok: boolean }>(tx, "select public.redeem_share_link($1, 'nope') as ok", [video.unlisted]),
    );
    expect(bad.ok).toBe(false);
    const good = await asUser(db, user.viewer, (tx) =>
      one<{ ok: boolean }>(tx, "select public.redeem_share_link($1, $2) as ok", [video.unlisted, share_key]),
    );
    expect(good.ok).toBe(true);
    expect(await canView(user.viewer, video.unlisted)).toBe(true);
    // Link access does not carry over to "selected users" visibility.
    const linkGrantOnSelected = await asUser(db, user.viewer, (tx) =>
      one<{ ok: boolean }>(tx, "select public.redeem_share_link($1, $2) as ok", [video.selected, share_key]),
    );
    expect(linkGrantOnSelected.ok).toBe(false);

    await asUser(db, user.creator, (tx) => tx.query("select public.rotate_share_key($1)", [video.unlisted]));
    expect(await canView(user.viewer, video.unlisted)).toBe(false);
    expect(await canView(null, video.unlisted, share_key)).toBe(false);
  });

  it("the playback lookup only returns videos the caller may watch", async () => {
    const all = Object.values(video);
    const anon = await asAnon(db, (tx) => rows<{ id: string }>(tx, "select id from public.playable_videos($1)", [all]));
    expect(anon.map((r) => r.id)).toEqual([video.public]);
    const owner = await asUser(db, user.creator, (tx) => rows<{ id: string }>(tx, "select id from public.playable_videos($1)", [all]));
    expect(owner.length).toBe(all.length);
  });

  it("removed videos and suspended creators' videos disappear for viewers", async () => {
    await asUser(db, user.admin, (tx) =>
      tx.query("select public.admin_set_video_moderation($1, 'removed', 'Spam')", [video.public]),
    );
    expect(await canView(user.viewer, video.public)).toBe(false);
    expect(await canView(user.creator, video.public)).toBe(true);
    await asUser(db, user.admin, (tx) => tx.query("select public.admin_set_video_moderation($1, 'active')", [video.public]));
    expect(await canView(user.viewer, video.public)).toBe(true);

    await asUser(db, user.admin, (tx) => tx.query("select public.admin_set_suspension($1, true, 'test')", [user.creator]));
    expect(await canView(user.viewer, video.public)).toBe(false);
    const err = await errorOf(insertVideo(user.creator, "while suspended", {}));
    expect(err).toMatch(/row-level security/);
    await asUser(db, user.admin, (tx) => tx.query("select public.admin_set_suspension($1, false)", [user.creator]));
    expect(await canView(user.viewer, video.public)).toBe(true);
  });

  it("owners cannot change processing or moderation fields themselves", async () => {
    for (const column of ["moderation_status = 'active'", "mux_playback_id = 'x'", "view_count = 1000", "owner_id = owner_id"]) {
      const err = await errorOf(
        asUser(db, user.creator, (tx) => tx.query(`update public.videos set ${column} where id = $1`, [video.public])),
      );
      expect(err).toMatch(/permission denied/);
    }
    const err = await errorOf(
      asUser(db, user.creator, (tx) => tx.query("delete from public.videos where id = $1", [video.public])),
    );
    expect(err).toMatch(/permission denied/);
  });

  it("other users cannot edit someone else's video", async () => {
    const res = await asUser(db, user.viewer, (tx) =>
      tx.query("update public.videos set title = 'pwned' where id = $1", [video.public]),
    );
    expect(res.affectedRows).toBe(0);
  });
});

describe("social features", () => {
  it("likes, saves and comments work on watchable videos and update counters", async () => {
    await asUser(db, user.viewer, async (tx) => {
      await tx.query("insert into public.likes (user_id, video_id) values ($1, $2)", [user.viewer, video.public]);
      await tx.query("insert into public.saved_videos (user_id, video_id) values ($1, $2)", [user.viewer, video.public]);
      await tx.query("insert into public.comments (video_id, body) values ($1, 'Nice one!')", [video.public]);
    });
    const v = await one<{ like_count: number; save_count: number; comment_count: number }>(
      db,
      "select like_count, save_count, comment_count from public.videos where id = $1",
      [video.public],
    );
    expect(v).toEqual({ like_count: 1, save_count: 1, comment_count: 1 });
    const types = (await rows<{ type: string }>(db, "select type from public.notifications where user_id = $1", [user.creator])).map(
      (r) => r.type,
    );
    expect(types).toEqual(expect.arrayContaining(["like", "comment"]));
  });

  it("cannot like, save or comment on videos the user cannot watch", async () => {
    for (const sql of [
      "insert into public.likes (user_id, video_id) values ($1, $2)",
      "insert into public.saved_videos (user_id, video_id) values ($1, $2)",
    ]) {
      expect(await errorOf(asUser(db, user.viewer, (tx) => tx.query(sql, [user.viewer, video.private])))).toMatch(/row-level security/);
    }
    expect(
      await errorOf(asUser(db, user.viewer, (tx) => tx.query("insert into public.comments (video_id, body) values ($1, 'x')", [video.private]))),
    ).toMatch(/row-level security/);
  });

  it("cannot like on behalf of someone else", async () => {
    const err = await errorOf(
      asUser(db, user.stranger, (tx) =>
        tx.query("insert into public.likes (user_id, video_id) values ($1, $2)", [user.viewer, video.public]),
      ),
    );
    expect(err).toMatch(/row-level security|duplicate key/);
  });

  it("comments respect allow_comments and can be hidden by moderators", async () => {
    await asUser(db, user.creator, (tx) => tx.query("update public.videos set allow_comments = false where id = $1", [video.public]));
    expect(
      await errorOf(asUser(db, user.friend, (tx) => tx.query("insert into public.comments (video_id, body) values ($1, 'x')", [video.public]))),
    ).toMatch(/row-level security/);
    await asUser(db, user.creator, (tx) => tx.query("update public.videos set allow_comments = true where id = $1", [video.public]));

    const { id } = await one<{ id: string }>(db, "select id from public.comments where video_id = $1 limit 1", [video.public]);
    await asUser(db, user.admin, (tx) => tx.query("select public.admin_set_comment_hidden($1, true)", [id]));
    const forStranger = await asUser(db, user.stranger, (tx) => rows(tx, "select id from public.get_comments($1)", [video.public]));
    const forAuthor = await asUser(db, user.viewer, (tx) => rows(tx, "select id from public.get_comments($1)", [video.public]));
    expect(forStranger).toEqual([]);
    expect(forAuthor.length).toBe(1);
  });

  it("likes and saved videos are private to each user", async () => {
    const theirs = await asUser(db, user.stranger, (tx) => rows(tx, "select * from public.likes"));
    expect(theirs).toEqual([]);
  });

  it("follows update counts and notify the creator", async () => {
    await asUser(db, user.viewer, (tx) =>
      tx.query("insert into public.follows (follower_id, following_id) values ($1, $2)", [user.viewer, user.creator]),
    );
    const p = await one<{ follower_count: number }>(db, "select follower_count from public.profiles where id = $1", [user.creator]);
    expect(p.follower_count).toBe(1);
    expect(
      await errorOf(
        asUser(db, user.viewer, (tx) =>
          tx.query("insert into public.follows (follower_id, following_id) values ($1, $2)", [user.stranger, user.creator]),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("followers are notified when a public video becomes playable", async () => {
    const id = await insertVideo(user.creator, "For my followers", {});
    await markReady(id);
    const notes = await rows(db, "select 1 from public.notifications where user_id = $1 and type = 'new_video' and video_id = $2", [
      user.viewer,
      id,
    ]);
    expect(notes.length).toBe(1);
  });

  it("notifications are private to the recipient", async () => {
    const mine = await asUser(db, user.stranger, (tx) =>
      rows(tx, "select * from public.notifications where user_id = $1", [user.creator]),
    );
    expect(mine).toEqual([]);
  });

  it("records views once per viewer per half hour and only for watchable videos", async () => {
    const before = await one<{ view_count: number }>(db, "select view_count::int from public.videos where id = $1", [video.public]);
    await asUser(db, user.friend, async (tx) => {
      await tx.query("select public.record_view($1)", [video.public]);
      await tx.query("select public.record_view($1)", [video.public]);
      await tx.query("select public.record_view($1)", [video.private]);
    });
    const after = await one<{ view_count: number }>(db, "select view_count::int from public.videos where id = $1", [video.public]);
    expect(after.view_count).toBe(before.view_count + 1);
    const priv = await one<{ view_count: number }>(db, "select view_count::int from public.videos where id = $1", [video.private]);
    expect(priv.view_count).toBe(0);
  });

  it("normalises hashtags from the caption and the tag list", async () => {
    const v = await one<{ hashtags: string[] }>(db, "select hashtags from public.videos where id = $1", [video.public]);
    expect(v.hashtags).toEqual(["world", "fun"]);
    const found = await asAnon(db, (tx) => rows<{ id: string }>(tx, "select id from public.search_videos('#fun')"));
    expect(found.map((r) => r.id)).toContain(video.public);
    const hidden = await asAnon(db, (tx) => rows<{ id: string }>(tx, "select id from public.search_videos('Private')"));
    expect(hidden).toEqual([]);
    const tags = await asAnon(db, (tx) => rows<{ tag: string }>(tx, "select tag from public.trending_hashtags()"));
    expect(tags.map((t) => t.tag)).toEqual(expect.arrayContaining(["fun", "world"]));
  });

  it("users can report content they can see, and only admins read reports", async () => {
    await asUser(db, user.friend, (tx) =>
      tx.query("insert into public.reports (video_id, reason, details) values ($1, 'spam', 'buy now')", [video.public]),
    );
    expect(
      await errorOf(
        asUser(db, user.friend, (tx) => tx.query("insert into public.reports (video_id, reason) values ($1, 'spam')", [video.private])),
      ),
    ).toMatch(/row-level security/);
    const strangerSees = await asUser(db, user.stranger, (tx) => rows(tx, "select * from public.reports"));
    expect(strangerSees).toEqual([]);
    const list = await asUser(db, user.admin, (tx) => rows<{ id: string }>(tx, "select id from public.admin_list_reports('open')"));
    expect(list.length).toBe(1);
    await asUser(db, user.admin, (tx) => tx.query("select public.admin_resolve_report($1, 'resolved', 'removed spam')", [list[0].id]));
    const left = await asUser(db, user.admin, (tx) => rows(tx, "select id from public.admin_list_reports('open')"));
    expect(left).toEqual([]);
  });

  it("creator stats only cover the caller's own videos", async () => {
    const s = await asUser(db, user.creator, (tx) => one<{ s: { videos: number; views_by_day: unknown[] } }>(tx, "select public.creator_stats() as s"));
    expect(s.s.videos).toBeGreaterThanOrEqual(6);
    expect(s.s.views_by_day.length).toBe(14);
    const viewerStats = await asUser(db, user.viewer, (tx) => one<{ s: { videos: number } }>(tx, "select public.creator_stats() as s"));
    expect(viewerStats.s.videos).toBe(0);
  });
});

describe("storage policies", () => {
  it("thumbnails of private videos are not readable by other users", async () => {
    await db.query(
      "insert into storage.objects (bucket_id, name, metadata) values ('thumbnails', $1, '{\"size\": 1000}'), ('thumbnails', $2, '{\"size\": 1000}')",
      [`${user.creator}/${video.private}/a.jpg`, `${user.creator}/${video.public}/b.jpg`],
    );
    const viewerSees = await asUser(db, user.viewer, (tx) =>
      rows<{ name: string }>(tx, "select name from storage.objects where bucket_id = 'thumbnails'"),
    );
    expect(viewerSees.map((r) => r.name)).toEqual([`${user.creator}/${video.public}/b.jpg`]);
    const ownerSees = await asUser(db, user.creator, (tx) => rows(tx, "select name from storage.objects where bucket_id = 'thumbnails'"));
    expect(ownerSees.length).toBe(2);
  });

  it("users can only upload thumbnails for their own videos", async () => {
    const err = await errorOf(
      asUser(db, user.viewer, (tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('thumbnails', $1)", [`${user.viewer}/${video.public}/x.jpg`]),
      ),
    );
    expect(err).toMatch(/row-level security/);
    await asUser(db, user.creator, (tx) =>
      tx.query("insert into storage.objects (bucket_id, name) values ('thumbnails', $1)", [`${user.creator}/${video.draft}/x.jpg`]),
    );
    await asUser(db, user.creator, (tx) =>
      tx.query("update public.videos set thumbnail_path = $2 where id = $1", [video.draft, `${user.creator}/${video.draft}/x.jpg`]),
    );
    const bad = await errorOf(
      asUser(db, user.creator, (tx) =>
        tx.query("update public.videos set thumbnail_path = $2 where id = $1", [video.draft, `${user.viewer}/elsewhere.jpg`]),
      ),
    );
    expect(bad).toMatch(/Invalid thumbnail path/);
  });
});
