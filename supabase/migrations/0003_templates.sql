-- Saved prompt templates (PROD-01). Applied to the live project 2026-08-05.
-- Deliberately no operation/tone columns — templates capture the words,
-- current UI state supplies the rest.
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  instructions text not null,
  created_at timestamptz not null default now()
);
create index templates_user_idx on public.templates (user_id, created_at desc);

alter table public.templates enable row level security;
create policy "own templates select" on public.templates
  for select using (user_id = auth.uid());
create policy "own templates insert" on public.templates
  for insert with check (user_id = auth.uid());
create policy "own templates delete" on public.templates
  for delete using (user_id = auth.uid());
