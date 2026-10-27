import { describe, expect, it } from "vitest";
import { createTestDb, migrationFiles, one } from "./harness";

describe("migrations", () => {
  it("apply cleanly to an empty database", async () => {
    const db = await createTestDb();
    expect(migrationFiles().length).toBeGreaterThanOrEqual(4);
    const { n } = await one<{ n: number }>(db, "select count(*)::int as n from public.categories");
    expect(n).toBeGreaterThan(5);
  });

  it("enable row level security on every public table", async () => {
    const db = await createTestDb();
    const res = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(res.rows).toEqual([]);
  });
});
