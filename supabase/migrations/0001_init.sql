-- Future core store. No person rows in this file — this repo is public.
-- RLS on; anon/authenticated denied. Service role bypasses RLS (Supabase default).
-- Do not store cookies, cache HTML, or LLM judge caches here.

create table people (
  slug text primary key,
  name text not null,
  country text,
  aliases jsonb not null default '[]'::jsonb,
  olympiad jsonb,
  linkedin jsonb,
  github jsonb,
  substack jsonb,
  website jsonb,
  links jsonb not null default '{}'::jsonb,
  identity jsonb not null default '{}'::jsonb,
  graph jsonb not null default '{}'::jsonb,
  footprint jsonb,
  scores jsonb,
  score_history jsonb not null default '[]'::jsonb,
  freshness jsonb not null default '{}'::jsonb,
  first_seen timestamptz not null default now(),
  last_updated timestamptz not null default now()
);

create table profiles (
  seed text not null,
  relation text not null,
  slug text not null,
  hop smallint not null default 1,
  parent_relation text,
  parent_slug text,
  name text not null,
  kind text not null,
  discovered_via jsonb not null default '[]'::jsonb,
  parents jsonb not null default '[]'::jsonb,
  linkedin jsonb,
  github jsonb,
  website jsonb,
  olympiad jsonb,
  links jsonb not null default '{}'::jsonb,
  context_score double precision not null default 0,
  context_signals jsonb not null default '[]'::jsonb,
  last_updated timestamptz not null default now(),
  primary key (seed, relation, slug, hop)
);

create table tree_edges (
  seed text not null,
  "from" text not null,
  from_github text not null,
  to_github text not null,
  via text not null,
  context_score double precision,
  context_signals jsonb,
  hop smallint not null default 1,
  via_node text,
  root_github text,
  parent_relation text,
  primary key (seed, "from", to_github, via, hop)
);

create table candidates (
  key text primary key,
  name text not null,
  discovered_via jsonb not null default '[]'::jsonb,
  final_score double precision not null default 0,
  identity_confidence double precision not null default 0,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

create table marks (
  id text primary key,
  name text not null,
  note text,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed_slug text,
  page_url text,
  candidate_id text
);

create table feedback (
  candidate_id text primary key,
  candidate_name text,
  entries jsonb not null default '[]'::jsonb,
  latest_verdict text not null,
  updated_at timestamptz not null default now()
);

create table assessment_runs (
  id text primary key,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  snapshot jsonb not null
);

alter table people enable row level security;
alter table profiles enable row level security;
alter table tree_edges enable row level security;
alter table candidates enable row level security;
alter table marks enable row level security;
alter table feedback enable row level security;
alter table assessment_runs enable row level security;

create policy people_deny_anon on people for all to anon using (false) with check (false);
create policy people_deny_authenticated on people for all to authenticated using (false) with check (false);

create policy profiles_deny_anon on profiles for all to anon using (false) with check (false);
create policy profiles_deny_authenticated on profiles for all to authenticated using (false) with check (false);

create policy tree_edges_deny_anon on tree_edges for all to anon using (false) with check (false);
create policy tree_edges_deny_authenticated on tree_edges for all to authenticated using (false) with check (false);

create policy candidates_deny_anon on candidates for all to anon using (false) with check (false);
create policy candidates_deny_authenticated on candidates for all to authenticated using (false) with check (false);

create policy marks_deny_anon on marks for all to anon using (false) with check (false);
create policy marks_deny_authenticated on marks for all to authenticated using (false) with check (false);

create policy feedback_deny_anon on feedback for all to anon using (false) with check (false);
create policy feedback_deny_authenticated on feedback for all to authenticated using (false) with check (false);

create policy assessment_runs_deny_anon on assessment_runs for all to anon using (false) with check (false);
create policy assessment_runs_deny_authenticated on assessment_runs for all to authenticated using (false) with check (false);
