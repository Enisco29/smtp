create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text check (name is null or char_length(name) <= 100),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.smtp_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  sender_name text check (sender_name is null or char_length(sender_name) <= 100),
  sender_email text not null check (char_length(trim(sender_email)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.smtp_account_secrets (
  smtp_account_id uuid primary key references public.smtp_accounts(id) on delete cascade,
  encrypted_password text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.smtp_verification_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger smtp_accounts_set_updated_at before update on public.smtp_accounts
for each row execute function private.set_updated_at();
create trigger smtp_secrets_set_updated_at before update on private.smtp_account_secrets
for each row execute function private.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.smtp_accounts enable row level security;

create policy "Users read their own profile" on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy "Users update their own name" on public.profiles
for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Users read their own SMTP metadata" on public.smtp_accounts
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;
revoke all on public.smtp_accounts from anon, authenticated;
grant select (id, user_id, sender_name, sender_email, created_at, updated_at) on public.smtp_accounts to authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.consume_smtp_verification_attempt()
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  row_data private.smtp_verification_limits%rowtype;
  window_length interval := interval '15 minutes';
  attempt_limit integer := 5;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  insert into private.smtp_verification_limits (user_id, attempts)
  values (actor, 1)
  on conflict (user_id) do update set
    window_started_at = case when private.smtp_verification_limits.window_started_at <= now() - window_length then now() else private.smtp_verification_limits.window_started_at end,
    attempts = case when private.smtp_verification_limits.window_started_at <= now() - window_length then 1 else private.smtp_verification_limits.attempts + 1 end
  returning * into row_data;
  if row_data.attempts > attempt_limit then
    return query select false, greatest(1, ceil(extract(epoch from ((row_data.window_started_at + window_length) - now())))::integer);
  else
    return query select true, 0;
  end if;
end;
$$;
revoke all on function public.consume_smtp_verification_attempt() from public, anon;
grant execute on function public.consume_smtp_verification_attempt() to authenticated;

create or replace function public.complete_onboarding_admin(
  p_user_id uuid, p_name text, p_sender_name text, p_sender_email text, p_encrypted_password text
) returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  insert into public.smtp_accounts (user_id, sender_name, sender_email)
  values (p_user_id, nullif(trim(p_sender_name), ''), lower(trim(p_sender_email)))
  on conflict (user_id) do update set sender_name = excluded.sender_name, sender_email = excluded.sender_email
  returning id into account_id;
  insert into private.smtp_account_secrets (smtp_account_id, encrypted_password)
  values (account_id, p_encrypted_password)
  on conflict (smtp_account_id) do update set encrypted_password = excluded.encrypted_password;
  update public.profiles set name = nullif(trim(p_name), ''), onboarding_completed_at = coalesce(onboarding_completed_at, now()) where id = p_user_id;
  if not found then raise exception 'Profile not found'; end if;
end;
$$;

create or replace function public.get_smtp_secret_admin(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' stable as $$
declare secret text;
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  select s.encrypted_password into secret from private.smtp_account_secrets s
  join public.smtp_accounts a on a.id = s.smtp_account_id where a.user_id = p_user_id;
  return secret;
end;
$$;

create or replace function public.update_smtp_settings_admin(
  p_user_id uuid, p_sender_name text, p_sender_email text, p_encrypted_password text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  update public.smtp_accounts set sender_name = nullif(trim(p_sender_name), ''), sender_email = lower(trim(p_sender_email))
  where user_id = p_user_id returning id into account_id;
  if account_id is null then raise exception 'SMTP account not found'; end if;
  if p_encrypted_password is not null then
    update private.smtp_account_secrets set encrypted_password = p_encrypted_password where smtp_account_id = account_id;
    if not found then raise exception 'SMTP secret not found'; end if;
  end if;
end;
$$;

revoke all on function public.complete_onboarding_admin(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_smtp_secret_admin(uuid) from public, anon, authenticated;
revoke all on function public.update_smtp_settings_admin(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_onboarding_admin(uuid, text, text, text, text) to service_role;
grant execute on function public.get_smtp_secret_admin(uuid) to service_role;
grant execute on function public.update_smtp_settings_admin(uuid, text, text, text) to service_role;
