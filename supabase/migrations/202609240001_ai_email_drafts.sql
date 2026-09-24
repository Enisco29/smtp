alter table public.profiles add column active_ai_provider text
  check (active_ai_provider in ('openai', 'grok', 'claude', 'gemini'));

create table public.ai_provider_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'grok', 'claude', 'gemini')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
create table private.ai_provider_secrets (
  user_id uuid not null,
  provider text not null,
  encrypted_key text not null,
  primary key (user_id, provider),
  foreign key (user_id, provider) references public.ai_provider_keys(user_id, provider) on delete cascade
);
create trigger ai_provider_keys_set_updated_at before update on public.ai_provider_keys
for each row execute function private.set_updated_at();
alter table public.ai_provider_keys enable row level security;
create policy "Users read their AI provider metadata" on public.ai_provider_keys
for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ai_provider_keys from anon, authenticated;
grant select on public.ai_provider_keys to authenticated;
revoke all on private.ai_provider_secrets from public, anon, authenticated;
grant select (active_ai_provider) on public.profiles to authenticated;

create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  recipient_id uuid not null references public.recipients(id) on delete cascade,
  subject text,
  body text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'generated', 'failed')),
  failure_code text,
  claim_token uuid,
  claim_expires_at timestamptz,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (campaign_id, recipient_id),
  check (status <> 'generated' or (nullif(trim(subject), '') is not null and nullif(trim(body), '') is not null and generated_at is not null))
);
create index email_drafts_campaign_status_idx on public.email_drafts (campaign_id, status);
create trigger email_drafts_set_updated_at before update on public.email_drafts
for each row execute function private.set_updated_at();
alter table public.email_drafts enable row level security;
create policy "Users read their campaign drafts" on public.email_drafts
for select to authenticated using (
  exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = (select auth.uid()))
);
revoke all on public.email_drafts from anon, authenticated;
grant select (id, campaign_id, recipient_id, subject, body, status, failure_code, generated_at, updated_at) on public.email_drafts to authenticated;

create or replace function public.manage_ai_provider_admin(
  p_user_id uuid, p_provider text, p_operation text, p_encrypted_key text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  if p_provider not in ('openai', 'grok', 'claude', 'gemini') then raise exception 'Invalid provider'; end if;
  if p_operation = 'save' then
    if nullif(p_encrypted_key, '') is null then raise exception 'Missing encrypted key'; end if;
    insert into public.ai_provider_keys (user_id, provider) values (p_user_id, p_provider)
    on conflict (user_id, provider) do update set updated_at = now();
    insert into private.ai_provider_secrets (user_id, provider, encrypted_key)
    values (p_user_id, p_provider, p_encrypted_key)
    on conflict (user_id, provider) do update set encrypted_key = excluded.encrypted_key;
  elsif p_operation = 'select' then
    if not exists (select 1 from public.ai_provider_keys where user_id = p_user_id and provider = p_provider) then
      raise exception 'Provider key not configured';
    end if;
    update public.profiles set active_ai_provider = p_provider where id = p_user_id;
  elsif p_operation = 'remove' then
    delete from public.ai_provider_keys where user_id = p_user_id and provider = p_provider;
    update public.profiles set active_ai_provider = null where id = p_user_id and active_ai_provider = p_provider;
  else
    raise exception 'Invalid operation';
  end if;
end;
$$;

create or replace function public.get_ai_key_admin(p_user_id uuid, p_provider text)
returns text language plpgsql security definer set search_path = '' stable as $$
declare encrypted text;
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  select encrypted_key into encrypted from private.ai_provider_secrets
  where user_id = p_user_id and provider = p_provider;
  return encrypted;
end;
$$;

create or replace function public.claim_campaign_drafts_admin(
  p_user_id uuid, p_campaign_id uuid, p_limit integer, p_retry_failed boolean default false
) returns table (draft_id uuid, recipient_id uuid, recipient_email text, recipient_data jsonb, token uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  if p_limit < 1 or p_limit > 8 then raise exception 'Invalid batch size'; end if;
  perform 1 from public.campaigns where id = p_campaign_id and user_id = p_user_id and status = 'draft' for update;
  if not found then raise exception 'Draft campaign not found'; end if;

  insert into public.email_drafts (campaign_id, recipient_id)
  select p_campaign_id, r.id from public.recipients r where r.campaign_id = p_campaign_id
  on conflict (campaign_id, recipient_id) do nothing;
  if p_retry_failed then
    update public.email_drafts set status = 'pending', failure_code = null
    where campaign_id = p_campaign_id and status = 'failed';
  end if;
  update public.email_drafts set status = 'pending', claim_token = null, claim_expires_at = null
  where campaign_id = p_campaign_id and status = 'processing' and claim_expires_at < now();

  return query with picked as (
    select d.id from public.email_drafts d
    where d.campaign_id = p_campaign_id and d.status = 'pending'
    order by d.updated_at, d.id limit p_limit for update skip locked
  ), claimed as (
    update public.email_drafts d set status = 'processing', claim_token = gen_random_uuid(),
      claim_expires_at = now() + interval '3 minutes'
    from picked where d.id = picked.id
    returning d.id, d.recipient_id, d.claim_token
  )
  select c.id, c.recipient_id, r.email, r.data, c.claim_token
  from claimed c join public.recipients r on r.id = c.recipient_id;
end;
$$;

create or replace function public.complete_campaign_draft_admin(
  p_user_id uuid, p_draft_id uuid, p_token uuid, p_status text,
  p_subject text default null, p_body text default null, p_failure_code text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  if p_status not in ('generated', 'failed') then raise exception 'Invalid result status'; end if;
  if p_status = 'generated' and (nullif(trim(p_subject), '') is null or nullif(trim(p_body), '') is null) then
    raise exception 'Missing draft content';
  end if;
  update public.email_drafts d set status = p_status,
    subject = case when p_status = 'generated' then p_subject else null end,
    body = case when p_status = 'generated' then p_body else null end,
    failure_code = case when p_status = 'failed' then p_failure_code else null end,
    generated_at = case when p_status = 'generated' then now() else null end,
    claim_token = null, claim_expires_at = null
  where d.id = p_draft_id and d.status = 'processing' and d.claim_token = p_token
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = p_user_id and c.status = 'draft');
  return found;
end;
$$;

revoke all on function public.manage_ai_provider_admin(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_ai_key_admin(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_campaign_drafts_admin(uuid, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.complete_campaign_draft_admin(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.manage_ai_provider_admin(uuid, text, text, text) to service_role;
grant execute on function public.get_ai_key_admin(uuid, text) to service_role;
grant execute on function public.claim_campaign_drafts_admin(uuid, uuid, integer, boolean) to service_role;
grant execute on function public.complete_campaign_draft_admin(uuid, uuid, uuid, text, text, text, text) to service_role;
