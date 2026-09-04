-- A single global switch: hard paywall from account creation, no trial.
--
-- Read/write only through admin_get_config / admin_set_hard_paywall, both
-- service_role-only (same pattern as 0006) — reachable exclusively from the
-- admin dashboard behind requireAdmin's ADMIN_EMAILS allow-list. Nothing in
-- the extension or the public schema can see or flip this.

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  hard_paywall boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1);
alter table public.app_settings enable row level security;
-- No policies: the table is reachable only through the SECURITY DEFINER
-- functions below, which run as the owner and bypass RLS entirely.
revoke all on public.app_settings from public, anon, authenticated;

create or replace function public.admin_get_config()
returns table(hard_paywall boolean)
language sql security definer set search_path = 'public'
as $$
  select hard_paywall from app_settings where id = 1;
$$;

/**
 * Flipping the paywall ON also ends every trial already in flight, not just
 * future signups — sehit's call 2026-09-04: he wants a real moment (friends
 * convert or lose access right then), not a slow fade as trials individually
 * expire days apart. Flipping it OFF only changes what NEW accounts get;
 * accounts already expired stay expired rather than being resurrected.
 */
create or replace function public.admin_set_hard_paywall(p_enabled boolean)
returns void
language plpgsql security definer set search_path = 'public'
as $$
begin
  update app_settings set hard_paywall = p_enabled, updated_at = now() where id = 1;

  if p_enabled then
    update billing set status = 'expired', trial_ends_at = now(), updated_at = now()
    where status = 'trialing' and trial_ends_at > now();
  end if;
end $$;

-- Explicit anon/authenticated revokes, not just PUBLIC: this project's
-- default privileges auto-grant EXECUTE to `authenticated` on every new
-- function, so a plain "revoke ... from public" leaves any signed-in user
-- able to call admin_set_hard_paywall directly. Caught live 2026-09-04 by
-- checking pg_proc.proacl right after the first version of this migration
-- ran — the wrong version briefly granted authenticated=X here too.
revoke all on function public.admin_get_config() from public, anon, authenticated;
revoke all on function public.admin_set_hard_paywall(boolean) from public, anon, authenticated;
grant execute on function public.admin_get_config() to service_role;
grant execute on function public.admin_set_hard_paywall(boolean) to service_role;

-- billing_init now checks the toggle: hard_paywall on means a brand new
-- account is born already expired, with no trial device recorded (so it
-- doesn't burn the one-trial-per-device allowance for nothing). Off keeps
-- the exact 0006 behaviour byte for byte.
create or replace function public.billing_init(p_user_id uuid, p_install_hash text)
returns table(status text, trial_ends_at timestamptz)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_device_used boolean;
  v_trial_end timestamptz;
  v_hard_paywall boolean;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from billing b where b.user_id = p_user_id) then
    return query select b.status, b.trial_ends_at from billing b where b.user_id = p_user_id;
    return;
  end if;

  select s.hard_paywall into v_hard_paywall from app_settings s where s.id = 1;

  if v_hard_paywall then
    insert into billing (user_id, status, trial_ends_at)
    values (p_user_id, 'expired', now());
    return query select b.status, b.trial_ends_at from billing b where b.user_id = p_user_id;
    return;
  end if;

  select exists (
    select 1 from trial_devices d
    where d.install_hash = p_install_hash and d.first_user_id <> p_user_id
  ) into v_device_used;

  if v_device_used then
    v_trial_end := now();  -- no fresh trial on a device that already had one
  else
    v_trial_end := now() + interval '7 days';
    insert into trial_devices (install_hash, first_user_id)
    values (p_install_hash, p_user_id)
    on conflict (install_hash) do nothing;
  end if;

  insert into billing (user_id, status, trial_ends_at)
  values (p_user_id, case when v_device_used then 'expired' else 'trialing' end, v_trial_end);

  return query select b.status, b.trial_ends_at from billing b where b.user_id = p_user_id;
end $$;
