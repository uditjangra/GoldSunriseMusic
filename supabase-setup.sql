-- ============================================================
--  Our Little Songbook — Supabase setup
--  1. Change the two emails just below.
--  2. Paste this whole file into Supabase → SQL Editor → Run.
--  Safe to run again later (e.g. if you change an email).
-- ============================================================

-- ✏️ YOUR email (the singer — can upload and edit everything)
create or replace function public.singer_email() returns text
language sql immutable as $$ select 'YOUR_EMAIL@example.com' $$;

-- ✏️ HER email (the listener — can listen and favorite songs)
create or replace function public.listener_email() returns text
language sql immutable as $$ select 'HER_EMAIL@example.com' $$;

-- ------------------------------------------------------------
create or replace function public.is_singer() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') = lower(public.singer_email()), false)
$$;

create or replace function public.is_listener() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') = lower(public.listener_email()), false)
$$;

create or replace function public.is_member() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') in (lower(public.singer_email()), lower(public.listener_email())), false)
$$;

-- Tables -----------------------------------------------------
create table if not exists public.profile (
  id            int primary key default 1 check (id = 1),
  name          text not null default 'My Music',
  bio           text not null default '',
  listener_name text not null default '',
  welcome       text not null default '',
  avatar_path   text,
  updated_at    timestamptz not null default now()
);
insert into public.profile (id) values (1) on conflict (id) do nothing;

create table if not exists public.releases (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('album', 'single')),
  title       text not null,
  description text not null default '',
  cover_path  text,
  color       text not null default '#f4a6c0',
  released_on date default current_date,
  created_at  timestamptz not null default now()
);

create table if not exists public.tracks (
  id          uuid primary key default gen_random_uuid(),
  release_id  uuid not null references public.releases(id) on delete cascade,
  title       text not null,
  note        text not null default '',
  lyrics      text not null default '',
  audio_path  text not null,
  duration    real,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists tracks_release_idx on public.tracks (release_id, position);

create table if not exists public.hearts (
  track_id   uuid primary key references public.tracks(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.requests (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  note       text not null default '',
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Privacy rules: only your two emails can see anything;
-- only you can change songs; both can favorite.
alter table public.profile  enable row level security;
alter table public.releases enable row level security;
alter table public.tracks   enable row level security;
alter table public.hearts   enable row level security;
alter table public.requests enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profile', 'releases', 'tracks'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "singer writes" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy "singer writes" on public.%I for all to authenticated using (public.is_singer()) with check (public.is_singer())', t);
  end loop;
end $$;

drop policy if exists "members hearts" on public.hearts;
create policy "members hearts" on public.hearts for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- Song requests: both can see them; only she can add, edit, tick or remove.
drop policy if exists "members read" on public.requests;
drop policy if exists "listener writes" on public.requests;
create policy "members read" on public.requests for select to authenticated using (public.is_member());
create policy "listener writes" on public.requests for all to authenticated
  using (public.is_listener()) with check (public.is_listener());

-- Live updates (so changes show up for her instantly)
do $$
declare t text;
begin
  foreach t in array array['profile', 'releases', 'tracks', 'hearts', 'requests'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- File storage (songs, covers, profile picture) — private bucket
insert into storage.buckets (id, name, public)
values ('music', 'music', false)
on conflict (id) do update set public = false;

drop policy if exists "songbook members read" on storage.objects;
drop policy if exists "songbook singer upload" on storage.objects;
drop policy if exists "songbook singer update" on storage.objects;
drop policy if exists "songbook singer delete" on storage.objects;

create policy "songbook members read" on storage.objects for select to authenticated
  using (bucket_id = 'music' and public.is_member());
create policy "songbook singer upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'music' and public.is_singer());
create policy "songbook singer update" on storage.objects for update to authenticated
  using (bucket_id = 'music' and public.is_singer());
create policy "songbook singer delete" on storage.objects for delete to authenticated
  using (bucket_id = 'music' and public.is_singer());
