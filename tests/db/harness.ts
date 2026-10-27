import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

/**
 * Minimal stand-in for the parts of Supabase the migrations depend on:
 * the anon/authenticated/service_role roles, auth.users + auth.uid(),
 * the storage schema, and Supabase's default grants on new public objects.
 */
const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create schema storage;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare
  _parts text[] := string_to_array(name, '/');
begin
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec("create publication supabase_realtime;");
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export type Queryable = Pick<PGlite, "query"> | Transaction;

/** Runs `fn` as an authenticated Supabase user (RLS enforced). */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await tx.query("set local role authenticated");
    return fn(tx);
  });
}

/** Runs `fn` as the anonymous role (RLS enforced). */
export async function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("set local role anon");
    return fn(tx);
  });
}

export async function one<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<T>(sql, params);
  if (result.rows.length !== 1) {
    throw new Error(`Expected exactly one row, got ${result.rows.length} for: ${sql}`);
  }
  return result.rows[0] as T;
}

export async function rows<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Captures the error message of a failing statement. */
export async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the statement to fail, but it succeeded");
}

/** Creates an auth user (the trigger creates the profile) and returns its id. */
export async function createUser(db: PGlite, username: string, extra: { role?: string; canUpload?: boolean } = {}) {
  const { id } = await one<{ id: string }>(
    db,
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [`${username}@example.com`, JSON.stringify({ username, display_name: username })],
  );
  if (extra.role || extra.canUpload) {
    await db.query("update public.profiles set role = coalesce($2::public.user_role, role), can_upload = $3 where id = $1", [
      id,
      extra.role ?? null,
      extra.canUpload ?? false,
    ]);
  }
  return id;
}
