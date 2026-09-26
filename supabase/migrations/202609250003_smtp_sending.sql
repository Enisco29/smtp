create table private.smtp_send_policy (
  id boolean primary key default true check (id),
  daily_limit integer not null default 100 check (daily_limit between 1 and 500),
  delay_ms integer not null default 2000 check (delay_ms between 1000 and 60000)
);
insert into private.smtp_send_policy (id) values (true);
revoke all on private.smtp_send_policy from public, anon, authenticated;
create function public.configure_smtp_send_policy_admin(p_daily_limit integer, p_delay_ms integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  update private.smtp_send_policy set daily_limit = p_daily_limit, delay_ms = p_delay_ms where id;
end;
$$;
revoke all on function public.configure_smtp_send_policy_admin(integer, integer) from public, anon, authenticated;
grant execute on function public.configure_smtp_send_policy_admin(integer, integer) to service_role;

alter table public.campaigns
  add column sending_started_at timestamptz,
  add column completed_at timestamptz,
  add constraint campaigns_status_check
    check (status in ('draft', 'sending', 'completed', 'completed_with_errors', 'finished'));

create table public.campaign_senders (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  smtp_account_id uuid not null references public.smtp_accounts(id),
  sender_name text,
  sender_email text not null,
  credential_status text not null default 'valid' check (credential_status in ('valid', 'invalid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger campaign_senders_set_updated_at before update on public.campaign_senders
for each row execute function private.set_updated_at();
alter table public.campaign_senders enable row level security;
create policy "Users read their campaign sender metadata" on public.campaign_senders
for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.campaign_senders from anon, authenticated;
grant select (campaign_id, user_id, sender_name, sender_email, credential_status, created_at, updated_at)
on public.campaign_senders to authenticated;

create table private.campaign_smtp_secrets (
  campaign_id uuid primary key references public.campaign_senders(campaign_id) on delete cascade,
  encrypted_password text not null,
  updated_at timestamptz not null default now()
);
create trigger campaign_smtp_secrets_set_updated_at before update on private.campaign_smtp_secrets
for each row execute function private.set_updated_at();
revoke all on private.campaign_smtp_secrets from public, anon, authenticated;

alter table public.email_drafts drop constraint email_drafts_status_check;
alter table public.email_drafts drop constraint email_drafts_status_content_check;
alter table public.email_drafts
  add column send_claim_token uuid,
  add column send_claim_expires_at timestamptz,
  add column send_attempt_count integer not null default 0 check (send_attempt_count >= 0),
  add column send_retryable boolean not null default false,
  add column send_error_code text,
  add column send_error_message text,
  add column last_send_attempt_at timestamptz,
  add column sent_at timestamptz,
  add constraint email_drafts_status_check check (
    status in ('pending', 'processing', 'generated', 'edited', 'approved', 'failed', 'excluded',
      'sending', 'sent', 'send_failed', 'uncertain')
  ),
  add constraint email_drafts_status_content_check check (
    (status in ('generated', 'edited', 'approved', 'excluded', 'sending', 'sent', 'send_failed', 'uncertain')
      and content_state is not null)
    or status in ('pending', 'processing', 'failed')
  );

grant select (
  send_attempt_count, send_retryable, send_error_code, send_error_message,
  last_send_attempt_at, sent_at
) on public.email_drafts to authenticated;

create table public.email_send_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  draft_id uuid not null references public.email_drafts(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('sending', 'sent', 'send_failed', 'uncertain')),
  claim_token uuid not null unique,
  error_code text,
  error_message text,
  retryable boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (draft_id, attempt_number)
);
create index email_send_events_campaign_started_idx
on public.email_send_events (campaign_id, started_at desc);
alter table public.email_send_events enable row level security;
create policy "Users read their campaign send events" on public.email_send_events
for select to authenticated using (
  exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = (select auth.uid()))
);
revoke all on public.email_send_events from anon, authenticated;
grant select (id, campaign_id, draft_id, attempt_number, status, error_code, error_message,
  retryable, started_at, finished_at) on public.email_send_events to authenticated;

create function private.update_campaign_delivery_status(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare total_recipients integer; terminal_recipients integer; error_recipients integer;
begin
  select count(*) into total_recipients from public.recipients r where r.campaign_id = p_campaign_id;
  select count(*), count(*) filter (where d.status in ('send_failed', 'uncertain'))
  into terminal_recipients, error_recipients
  from public.email_drafts d
  where d.campaign_id = p_campaign_id
    and (d.status in ('sent', 'excluded', 'uncertain') or (d.status = 'send_failed' and not d.send_retryable));
  if total_recipients > 0 and terminal_recipients = total_recipients then
    update public.campaigns set
      status = case when error_recipients > 0 then 'completed_with_errors' else 'completed' end,
      completed_at = now()
    where id = p_campaign_id and status = 'sending';
  end if;
end;
$$;
revoke all on function private.update_campaign_delivery_status(uuid) from public, anon, authenticated;

create function public.start_campaign_sending_admin(p_user_id uuid, p_campaign_id uuid, p_expected_email text, p_expected_secret text)
returns void language plpgsql security definer set search_path = '' as $$
declare account public.smtp_accounts%rowtype; encrypted text;
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  perform 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = p_user_id
    and c.status in ('draft', 'sending') for update;
  if not found then raise exception 'Campaign cannot start sending'; end if;
  if not exists (select 1 from public.email_drafts d where d.campaign_id = p_campaign_id and d.status = 'approved') then
    raise exception 'No approved drafts';
  end if;
  select a.* into account from public.smtp_accounts a where a.user_id = p_user_id;
  select s.encrypted_password into encrypted from private.smtp_account_secrets s
    where s.smtp_account_id = account.id;
  if account.id is null or encrypted is null then raise exception 'SMTP configuration missing'; end if;
  if account.sender_email is distinct from p_expected_email or encrypted is distinct from p_expected_secret then
    raise exception 'SMTP settings changed during verification';
  end if;
  insert into public.campaign_senders (campaign_id, user_id, smtp_account_id, sender_name, sender_email)
  values (p_campaign_id, p_user_id, account.id, account.sender_name, account.sender_email)
  on conflict (campaign_id) do nothing;
  insert into private.campaign_smtp_secrets (campaign_id, encrypted_password)
  values (p_campaign_id, encrypted) on conflict (campaign_id) do nothing;
  update public.campaigns set status = 'sending', sending_started_at = coalesce(sending_started_at, now())
  where id = p_campaign_id and status = 'draft';
end;
$$;

create function public.get_campaign_smtp_secret_admin(p_user_id uuid, p_campaign_id uuid)
returns text language plpgsql security definer set search_path = '' stable as $$
declare encrypted text;
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  select s.encrypted_password into encrypted from private.campaign_smtp_secrets s
  join public.campaign_senders cs on cs.campaign_id = s.campaign_id
  join public.campaigns c on c.id = cs.campaign_id
  where s.campaign_id = p_campaign_id and cs.user_id = p_user_id and c.status = 'sending';
  return encrypted;
end;
$$;

create function public.reconnect_campaign_smtp_admin(
  p_user_id uuid, p_campaign_id uuid, p_encrypted_password text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  perform 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = p_user_id and c.status = 'sending' for update;
  if nullif(p_encrypted_password, '') is null then raise exception 'Missing credential'; end if;
  update private.campaign_smtp_secrets s set encrypted_password = p_encrypted_password
  where s.campaign_id = p_campaign_id and exists (
    select 1 from public.campaign_senders cs join public.campaigns c on c.id = cs.campaign_id
    where cs.campaign_id = s.campaign_id and cs.user_id = p_user_id and c.status = 'sending'
  );
  if not found then raise exception 'Sending campaign not found'; end if;
  update public.campaign_senders set credential_status = 'valid'
  where campaign_id = p_campaign_id and user_id = p_user_id;
end;
$$;

create function public.claim_next_email_send(
  p_campaign_id uuid, p_daily_limit integer, p_retry_failed boolean default false,
  p_draft_id uuid default null, p_retry_before timestamptz default now()
) returns table (
  draft_id uuid, recipient_email text, subject text, body text, token uuid, attempt_number integer
) language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); account_id uuid; used integer; picked uuid; new_token uuid; attempt integer; policy private.smtp_send_policy%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  perform 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = actor and c.status = 'sending' for update;
  if p_daily_limit < 1 or p_daily_limit > 500 then raise exception 'Invalid daily limit'; end if;
  select cs.smtp_account_id into account_id from public.campaign_senders cs
  join public.campaigns c on c.id = cs.campaign_id
  where cs.campaign_id = p_campaign_id and cs.user_id = actor and c.status = 'sending'
    and cs.credential_status = 'valid';
  if account_id is null then raise exception 'Campaign sender unavailable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account_id::text, 0));
  select * into policy from private.smtp_send_policy where id = true;
  if exists (select 1 from public.email_drafts d join public.campaign_senders cs on cs.campaign_id = d.campaign_id
    where cs.smtp_account_id = account_id and d.status = 'sending' and d.send_claim_expires_at >= now()) then return; end if;
  if exists (select 1 from public.email_send_events e join public.campaign_senders cs on cs.campaign_id = e.campaign_id
    where cs.smtp_account_id = account_id and (e.finished_at > now() - policy.delay_ms * interval '1 millisecond'
      or (e.error_code = 'smtp_rate_limited' and e.finished_at > now() - interval '15 minutes'))) then return; end if;

  update public.email_send_events e set status = 'uncertain', error_code = 'claim_expired',
    error_message = 'The sending request ended before Gmail acceptance could be confirmed.', retryable = false,
    finished_at = now()
  where e.campaign_id = p_campaign_id and e.status = 'sending' and exists (
    select 1 from public.email_drafts d where d.id = e.draft_id and d.send_claim_token = e.claim_token
      and d.send_claim_expires_at < now()
  );
  update public.email_drafts d set status = 'uncertain', send_retryable = false,
    send_error_code = 'claim_expired',
    send_error_message = 'The sending request ended before Gmail acceptance could be confirmed.',
    send_claim_token = null, send_claim_expires_at = null
  where d.campaign_id = p_campaign_id and d.status = 'sending' and d.send_claim_expires_at < now();

  select count(*) into used from public.email_send_events e
  join public.campaign_senders cs on cs.campaign_id = e.campaign_id
  where cs.smtp_account_id = account_id and e.started_at > now() - interval '24 hours';
  if used >= policy.daily_limit then raise exception 'Daily sending limit reached'; end if;

  select d.id into picked from public.email_drafts d
  where d.campaign_id = p_campaign_id
    and (p_draft_id is null or d.id = p_draft_id)
    and d.approved_at is not null and nullif(trim(d.subject), '') is not null and nullif(trim(d.body), '') is not null
    and ((not p_retry_failed and d.status = 'approved')
      or (p_retry_failed and d.status = 'send_failed' and d.send_retryable
        and d.last_send_attempt_at < least(p_retry_before, now())))
  order by d.approved_at nulls last, d.updated_at, d.id limit 1 for update skip locked;
  if picked is null then return; end if;
  new_token := gen_random_uuid();
  update public.email_drafts d set status = 'sending', send_claim_token = new_token,
    send_claim_expires_at = now() + interval '90 seconds', send_attempt_count = d.send_attempt_count + 1,
    last_send_attempt_at = now(), send_error_code = null, send_error_message = null, send_retryable = false
  where d.id = picked returning d.send_attempt_count into attempt;
  insert into public.email_send_events (campaign_id, draft_id, attempt_number, status, claim_token)
  values (p_campaign_id, picked, attempt, 'sending', new_token);
  return query select d.id, r.email, d.subject, d.body, new_token, attempt
  from public.email_drafts d join public.recipients r on r.id = d.recipient_id where d.id = picked;
end;
$$;

create function public.finalize_email_send(
  p_campaign_id uuid, p_draft_id uuid, p_token uuid, p_status text,
  p_error_code text default null, p_error_message text default null, p_retryable boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); next_status text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  perform 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = actor and c.status = 'sending' for update;
  if p_status not in ('sent', 'send_failed', 'uncertain') then raise exception 'Invalid send status'; end if;
  if char_length(coalesce(p_error_code, '')) > 80 or char_length(coalesce(p_error_message, '')) > 300 then
    raise exception 'Invalid safe error';
  end if;
  next_status := p_status;
  update public.email_drafts d set status = next_status,
    sent_at = case when next_status = 'sent' then now() else d.sent_at end,
    send_error_code = case when next_status = 'sent' then null else p_error_code end,
    send_error_message = case when next_status = 'sent' then null else p_error_message end,
    send_retryable = case when next_status = 'send_failed' then p_retryable else false end,
    send_claim_token = null, send_claim_expires_at = null
  where d.id = p_draft_id and d.campaign_id = p_campaign_id and d.status = 'sending'
    and d.send_claim_token = p_token and exists (
      select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = actor and c.status = 'sending'
    );
  if not found then return false; end if;
  update public.email_send_events set status = next_status, error_code = case when next_status = 'sent' then null else p_error_code end,
    error_message = case when next_status = 'sent' then null else p_error_message end,
    retryable = case when next_status = 'send_failed' then p_retryable else false end, finished_at = now()
  where claim_token = p_token and status = 'sending';
  if p_error_code = 'smtp_auth' then
    update public.campaign_senders set credential_status = 'invalid' where campaign_id = p_campaign_id and user_id = actor;
  end if;
  perform private.update_campaign_delivery_status(p_campaign_id);
  return true;
end;
$$;

create function public.refresh_campaign_send_state(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = auth.uid() for update;
  if not exists (select 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = auth.uid()) then
    raise exception 'Campaign not found';
  end if;
  update public.email_send_events e set status = 'uncertain', error_code = 'claim_expired',
    error_message = 'The sending request ended before Gmail acceptance could be confirmed.', retryable = false,
    finished_at = now()
  where e.campaign_id = p_campaign_id and e.status = 'sending' and exists (
    select 1 from public.email_drafts d where d.id = e.draft_id and d.send_claim_token = e.claim_token
      and d.send_claim_expires_at < now()
  );
  update public.email_drafts d set status = 'uncertain', send_retryable = false,
    send_error_code = 'claim_expired', send_error_message = 'The sending request ended before Gmail acceptance could be confirmed.',
    send_claim_token = null, send_claim_expires_at = null
  where d.campaign_id = p_campaign_id and d.status = 'sending' and d.send_claim_expires_at < now();
  perform private.update_campaign_delivery_status(p_campaign_id);
end;
$$;

create function public.finish_campaign(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = auth.uid()
    and c.status = 'sending' for update;
  if not found then raise exception 'Sending campaign not found'; end if;
  if exists (select 1 from public.email_drafts d where d.campaign_id = p_campaign_id
    and d.status = 'sending' and d.send_claim_expires_at >= now()) then
    raise exception 'A send is still in progress';
  end if;
  perform public.refresh_campaign_send_state(p_campaign_id);
  update public.campaigns set status = 'finished', completed_at = now() where id = p_campaign_id;
end;
$$;

revoke all on function public.start_campaign_sending_admin(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_campaign_smtp_secret_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reconnect_campaign_smtp_admin(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_next_email_send(uuid, integer, boolean, uuid, timestamptz) from public, anon;
revoke all on function public.finalize_email_send(uuid, uuid, uuid, text, text, text, boolean) from public, anon;
revoke all on function public.refresh_campaign_send_state(uuid) from public, anon;
revoke all on function public.finish_campaign(uuid) from public, anon;
grant execute on function public.start_campaign_sending_admin(uuid, uuid, text, text) to service_role;
grant execute on function public.get_campaign_smtp_secret_admin(uuid, uuid) to service_role;
grant execute on function public.reconnect_campaign_smtp_admin(uuid, uuid, text) to service_role;
grant execute on function public.claim_next_email_send(uuid, integer, boolean, uuid, timestamptz) to authenticated;
grant execute on function public.finalize_email_send(uuid, uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.refresh_campaign_send_state(uuid) to authenticated;
grant execute on function public.finish_campaign(uuid) to authenticated;

create function private.lock_draft_campaign(p_draft_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.campaigns c join public.email_drafts d on d.campaign_id = c.id
  where d.id = p_draft_id and c.user_id = p_actor and c.status in ('draft', 'sending') for update of c;
  if not found then raise exception 'Campaign is closed or draft not found'; end if;
end;
$$;
revoke all on function private.lock_draft_campaign(uuid, uuid) from public, anon, authenticated;

-- Phase 3 generation may continue for unsent recipients after sending starts.
create or replace function public.claim_campaign_drafts_admin(
  p_user_id uuid, p_campaign_id uuid, p_limit integer, p_retry_failed boolean default false
) returns table (draft_id uuid, recipient_id uuid, recipient_email text, recipient_data jsonb, token uuid, content_revision bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  if p_limit < 1 or p_limit > 8 then raise exception 'Invalid batch size'; end if;
  perform 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = p_user_id
    and c.status in ('draft', 'sending') for update;
  if not found then raise exception 'Campaign is not open for draft generation'; end if;
  insert into public.email_drafts (campaign_id, recipient_id)
  select p_campaign_id, r.id from public.recipients r where r.campaign_id = p_campaign_id
  on conflict on constraint email_drafts_campaign_id_recipient_id_key do nothing;
  if p_retry_failed then
    update public.email_drafts d set status = 'pending', failure_code = null, claim_token = null, claim_expires_at = null
    where d.campaign_id = p_campaign_id and d.status = 'failed' and d.content_state is null;
  end if;
  update public.email_drafts d set status = 'pending', claim_token = null, claim_expires_at = null
  where d.campaign_id = p_campaign_id and d.status = 'processing' and d.content_state is null and d.claim_expires_at < now();
  return query with picked as (
    select d.id from public.email_drafts d where d.campaign_id = p_campaign_id and d.status = 'pending'
      and d.content_state is null order by d.updated_at, d.id limit p_limit for update skip locked
  ), claimed as (
    update public.email_drafts d set status = 'processing', claim_token = gen_random_uuid(), claim_expires_at = now() + interval '3 minutes'
    from picked p where d.id = p.id returning d.id, d.recipient_id, d.claim_token, d.content_revision
  ) select c.id, c.recipient_id, r.email, r.data, c.claim_token, c.content_revision
  from claimed c join public.recipients r on r.id = c.recipient_id;
end;
$$;

create or replace function public.complete_campaign_draft_admin(
  p_user_id uuid, p_draft_id uuid, p_token uuid, p_expected_revision bigint,
  p_status text, p_subject text default null, p_body text default null, p_failure_code text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  perform private.lock_draft_campaign(p_draft_id, p_user_id);
  if p_status not in ('generated', 'failed') then raise exception 'Invalid result status'; end if;
  if p_status = 'generated' and (nullif(trim(p_subject), '') is null or nullif(trim(p_body), '') is null) then raise exception 'Missing draft content'; end if;
  if p_status = 'generated' then
    update public.email_drafts d set status = 'generated', content_state = 'generated', subject = p_subject, body = p_body,
      content_revision = d.content_revision + 1, failure_code = null, generated_at = now(), approved_at = null,
      excluded_at = null, claim_token = null, claim_expires_at = null
    where d.id = p_draft_id and d.status = 'processing' and d.claim_token = p_token
      and d.content_revision = p_expected_revision and d.content_state is null
      and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = p_user_id and c.status in ('draft', 'sending'));
  else
    update public.email_drafts d set status = 'failed', failure_code = coalesce(nullif(p_failure_code, ''), 'request_failed'),
      claim_token = null, claim_expires_at = null
    where d.id = p_draft_id and d.status = 'processing' and d.claim_token = p_token
      and d.content_revision = p_expected_revision and d.content_state is null
      and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = p_user_id and c.status in ('draft', 'sending'));
  end if;
  return found;
end;
$$;

-- Phase 4 mutations remain available only for drafts that have not entered delivery.
create or replace function public.edit_email_draft(p_draft_id uuid, p_expected_revision bigint, p_subject text, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  perform private.lock_draft_campaign(p_draft_id, auth.uid());
  if nullif(trim(p_subject), '') is null or nullif(trim(p_body), '') is null then raise exception 'Subject and body are required'; end if;
  update public.email_drafts d set subject = p_subject, body = p_body, status = 'edited', content_state = 'edited',
    content_revision = d.content_revision + 1, approved_at = null, excluded_at = null, failure_code = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision and d.status in ('generated', 'edited', 'approved')
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status in ('draft', 'sending'))
  returning d.content_revision into next_revision;
  if next_revision is null then raise exception 'Draft changed or is not editable'; end if;
  return next_revision;
end;
$$;

create or replace function public.approve_email_draft(p_draft_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  perform private.lock_draft_campaign(p_draft_id, auth.uid());
  update public.email_drafts d set status = 'approved', approved_at = now(), excluded_at = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision and d.status in ('generated', 'edited')
    and d.content_state in ('generated', 'edited') and nullif(trim(d.subject), '') is not null and nullif(trim(d.body), '') is not null
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status in ('draft', 'sending'));
  if not found then raise exception 'Draft changed or is not eligible for approval'; end if;
end;
$$;

create or replace function public.approve_all_email_drafts(p_campaign_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  perform 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = auth.uid() and c.status in ('draft', 'sending') for update;
  if not found then raise exception 'Campaign not open for review'; end if;
  update public.email_drafts d set status = 'approved', approved_at = now(), excluded_at = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.campaign_id = p_campaign_id and d.status in ('generated', 'edited') and d.content_state in ('generated', 'edited')
    and nullif(trim(d.subject), '') is not null and nullif(trim(d.body), '') is not null;
  get diagnostics affected = row_count; return affected;
end;
$$;

create or replace function public.exclude_email_draft(p_draft_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare campaign uuid;
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  perform private.lock_draft_campaign(p_draft_id, auth.uid());
  update public.email_drafts d set status = 'excluded', excluded_at = now(), approved_at = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision and d.status in ('generated', 'edited', 'approved')
    and d.content_state in ('generated', 'edited') and exists (
      select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status in ('draft', 'sending')
    ) returning d.campaign_id into campaign;
  if campaign is null then raise exception 'Draft changed or cannot be excluded'; end if;
  perform private.update_campaign_delivery_status(campaign);
end;
$$;

create or replace function public.restore_email_draft(p_draft_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  perform private.lock_draft_campaign(p_draft_id, auth.uid());
  update public.email_drafts d set status = d.content_state, excluded_at = null, approved_at = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision and d.status = 'excluded'
    and d.content_state in ('generated', 'edited') and exists (
      select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status in ('draft', 'sending')
    );
  if not found then raise exception 'Draft changed or cannot be restored'; end if;
end;
$$;

create or replace function public.claim_review_ai(p_draft_id uuid, p_expected_revision bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  perform private.lock_draft_campaign(p_draft_id, auth.uid());
  update public.email_drafts d set review_claim_token = token, review_claim_expires_at = now() + interval '3 minutes', review_claim_status = d.status
  where d.id = p_draft_id and d.content_revision = p_expected_revision and d.status in ('generated', 'edited', 'approved')
    and d.content_state in ('generated', 'edited') and (d.review_claim_token is null or d.review_claim_expires_at < now())
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status in ('draft', 'sending'));
  if not found then raise exception 'Draft changed or is busy'; end if; return token;
end;
$$;

create or replace function public.complete_review_ai_admin(
  p_user_id uuid, p_draft_id uuid, p_token uuid, p_expected_revision bigint,
  p_content_state text, p_subject text, p_body text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  perform private.lock_draft_campaign(p_draft_id, p_user_id);
  if p_content_state not in ('generated', 'edited') then raise exception 'Invalid content state'; end if;
  if nullif(trim(p_subject), '') is null or nullif(trim(p_body), '') is null then raise exception 'Missing draft content'; end if;
  update public.email_drafts d set subject = p_subject, body = p_body, status = p_content_state, content_state = p_content_state,
    content_revision = d.content_revision + 1, approved_at = null, excluded_at = null, failure_code = null,
    generated_at = now(), review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision and d.review_claim_token = p_token
    and d.review_claim_expires_at >= now() and d.status = d.review_claim_status and d.status in ('generated', 'edited', 'approved')
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = p_user_id and c.status in ('draft', 'sending'));
  return found;
end;
$$;
