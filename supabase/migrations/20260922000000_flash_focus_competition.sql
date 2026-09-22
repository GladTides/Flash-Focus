create extension if not exists pgcrypto;

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  organization_name text,
  is_open boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.participant_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname varchar(18) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete restrict,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  duration_ms integer,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'rejected')),
  score integer,
  best_streak integer,
  accuracy numeric(5, 2),
  average_reaction_ms integer,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete restrict,
  nickname varchar(18) not null,
  best_score integer not null default 0,
  best_streak integer not null default 0,
  best_accuracy numeric(5, 2) not null default 0,
  best_average_reaction_ms integer not null default 0,
  games_played integer not null default 0,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, competition_id)
);

create index if not exists game_sessions_user_competition_idx
  on public.game_sessions (user_id, competition_id, created_at desc);

create index if not exists leaderboard_entries_competition_score_idx
  on public.leaderboard_entries (competition_id, best_score desc, best_streak desc, best_accuracy desc, best_average_reaction_ms asc);

insert into public.competitions (slug, name, organization_name)
values ('flash-focus-2026', 'Flash Focus Competition', 'Al-Futtaim')
on conflict (slug) do nothing;

alter table public.competitions enable row level security;
alter table public.participant_profiles enable row level security;
alter table public.game_sessions enable row level security;
alter table public.leaderboard_entries enable row level security;

drop policy if exists "competition service access only" on public.competitions;
drop policy if exists "participant service access only" on public.participant_profiles;
drop policy if exists "session service access only" on public.game_sessions;
drop policy if exists "leaderboard service access only" on public.leaderboard_entries;

create policy "competition service access only"
  on public.competitions for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "participant service access only"
  on public.participant_profiles for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "session service access only"
  on public.game_sessions for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "leaderboard service access only"
  on public.leaderboard_entries for all
  to anon, authenticated
  using (false)
  with check (false);