alter table public.email_drafts drop constraint email_drafts_status_check;
alter table public.email_drafts
  add column content_state text check (content_state in ('generated', 'edited')),
  add column content_revision bigint not null default 1 check (content_revision > 0),
  add column approved_at timestamptz,
  add column excluded_at timestamptz,
  add column review_claim_token uuid,
  add column review_claim_expires_at timestamptz,
  add column review_claim_status text;

update public.email_drafts
set content_state = 'generated'
where status = 'generated';

alter table public.email_drafts
  add constraint email_drafts_status_check
    check (status in ('pending', 'processing', 'generated', 'edited', 'approved', 'failed', 'excluded')),
  add constraint email_drafts_status_content_check
    check (
      (status in ('generated', 'edited', 'approved', 'excluded') and content_state is not null)
      or status in ('pending', 'processing', 'failed')
    ),
  add constraint email_drafts_review_claim_status_check
    check (review_claim_status is null or review_claim_status in ('generated', 'edited', 'approved'));

grant select (
  id, campaign_id, recipient_id, subject, body, status, content_state,
  content_revision, failure_code, generated_at, approved_at, excluded_at, updated_at
) on public.email_drafts to authenticated;

drop function public.claim_campaign_drafts_admin(uuid, uuid, integer, boolean);
drop function public.complete_campaign_draft_admin(uuid, uuid, uuid, text, text, text, text);

create function public.claim_campaign_drafts_admin(
  p_user_id uuid, p_campaign_id uuid, p_limit integer, p_retry_failed boolean default false
) returns table (
  draft_id uuid, recipient_id uuid, recipient_email text,
  recipient_data jsonb, token uuid, content_revision bigint
) language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  if p_limit < 1 or p_limit > 8 then raise exception 'Invalid batch size'; end if;

  perform 1 from public.campaigns c
  where c.id = p_campaign_id and c.user_id = p_user_id and c.status = 'draft'
  for update;
  if not found then raise exception 'Draft campaign not found'; end if;

  insert into public.email_drafts (campaign_id, recipient_id)
  select p_campaign_id, r.id from public.recipients r where r.campaign_id = p_campaign_id
  on conflict on constraint email_drafts_campaign_id_recipient_id_key do nothing;

  if p_retry_failed then
    update public.email_drafts d
    set status = 'pending', failure_code = null, claim_token = null, claim_expires_at = null
    where d.campaign_id = p_campaign_id and d.status = 'failed' and d.content_state is null;
  end if;

  update public.email_drafts d
  set status = 'pending', claim_token = null, claim_expires_at = null
  where d.campaign_id = p_campaign_id and d.status = 'processing'
    and d.content_state is null and d.claim_expires_at < now();

  return query with picked as (
    select d.id from public.email_drafts d
    where d.campaign_id = p_campaign_id and d.status = 'pending' and d.content_state is null
    order by d.updated_at, d.id limit p_limit for update skip locked
  ), claimed as (
    update public.email_drafts d
    set status = 'processing', claim_token = gen_random_uuid(),
      claim_expires_at = now() + interval '3 minutes'
    from picked p where d.id = p.id
    returning d.id, d.recipient_id, d.claim_token, d.content_revision
  )
  select c.id, c.recipient_id, r.email, r.data, c.claim_token, c.content_revision
  from claimed c join public.recipients r on r.id = c.recipient_id;
end;
$$;

create function public.complete_campaign_draft_admin(
  p_user_id uuid, p_draft_id uuid, p_token uuid, p_expected_revision bigint,
  p_status text, p_subject text default null, p_body text default null,
  p_failure_code text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  if p_status not in ('generated', 'failed') then raise exception 'Invalid result status'; end if;
  if p_status = 'generated' and (nullif(trim(p_subject), '') is null or nullif(trim(p_body), '') is null) then
    raise exception 'Missing draft content';
  end if;

  if p_status = 'generated' then
    update public.email_drafts d set
      status = 'generated', content_state = 'generated', subject = p_subject, body = p_body,
      content_revision = d.content_revision + 1, failure_code = null, generated_at = now(),
      approved_at = null, excluded_at = null, claim_token = null, claim_expires_at = null
    where d.id = p_draft_id and d.status = 'processing' and d.claim_token = p_token
      and d.content_revision = p_expected_revision and d.content_state is null
      and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = p_user_id and c.status = 'draft');
  else
    update public.email_drafts d set
      status = 'failed', failure_code = coalesce(nullif(p_failure_code, ''), 'request_failed'),
      claim_token = null, claim_expires_at = null
    where d.id = p_draft_id and d.status = 'processing' and d.claim_token = p_token
      and d.content_revision = p_expected_revision and d.content_state is null
      and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = p_user_id and c.status = 'draft');
  end if;
  return found;
end;
$$;

create function public.edit_email_draft(
  p_draft_id uuid, p_expected_revision bigint, p_subject text, p_body text
) returns bigint language plpgsql security definer set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  if nullif(trim(p_subject), '') is null or nullif(trim(p_body), '') is null then raise exception 'Subject and body are required'; end if;
  update public.email_drafts d set
    subject = p_subject, body = p_body, status = 'edited', content_state = 'edited',
    content_revision = d.content_revision + 1, approved_at = null, excluded_at = null,
    failure_code = null, review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision
    and d.status in ('generated', 'edited', 'approved')
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status = 'draft')
  returning d.content_revision into next_revision;
  if next_revision is null then raise exception 'Draft changed or is not editable'; end if;
  return next_revision;
end;
$$;

create function public.approve_email_draft(p_draft_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  update public.email_drafts d set status = 'approved', approved_at = now(), excluded_at = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision
    and d.status in ('generated', 'edited') and d.content_state in ('generated', 'edited')
    and nullif(trim(d.subject), '') is not null and nullif(trim(d.body), '') is not null
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status = 'draft');
  if not found then raise exception 'Draft changed or is not eligible for approval'; end if;
end;
$$;

create function public.approve_all_email_drafts(p_campaign_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  if not exists (select 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = auth.uid() and c.status = 'draft') then
    raise exception 'Draft campaign not found';
  end if;
  update public.email_drafts d set status = 'approved', approved_at = now(), excluded_at = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.campaign_id = p_campaign_id and d.status in ('generated', 'edited')
    and d.content_state in ('generated', 'edited')
    and nullif(trim(d.subject), '') is not null and nullif(trim(d.body), '') is not null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function public.exclude_email_draft(p_draft_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  update public.email_drafts d set status = 'excluded', excluded_at = now(), approved_at = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision
    and d.status in ('generated', 'edited', 'approved') and d.content_state in ('generated', 'edited')
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status = 'draft');
  if not found then raise exception 'Draft changed or cannot be excluded'; end if;
end;
$$;

create function public.restore_email_draft(p_draft_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  update public.email_drafts d set status = d.content_state, excluded_at = null, approved_at = null,
    review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision and d.status = 'excluded'
    and d.content_state in ('generated', 'edited')
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status = 'draft');
  if not found then raise exception 'Draft changed or cannot be restored'; end if;
end;
$$;

create function public.claim_review_ai(p_draft_id uuid, p_expected_revision bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Unauthenticated'; end if;
  update public.email_drafts d set review_claim_token = token,
    review_claim_expires_at = now() + interval '3 minutes', review_claim_status = d.status
  where d.id = p_draft_id and d.content_revision = p_expected_revision
    and d.status in ('generated', 'edited', 'approved') and d.content_state in ('generated', 'edited')
    and (d.review_claim_token is null or d.review_claim_expires_at < now())
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = auth.uid() and c.status = 'draft');
  if not found then raise exception 'Draft changed or is busy'; end if;
  return token;
end;
$$;

create function public.complete_review_ai_admin(
  p_user_id uuid, p_draft_id uuid, p_token uuid, p_expected_revision bigint,
  p_content_state text, p_subject text, p_body text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  if p_content_state not in ('generated', 'edited') then raise exception 'Invalid content state'; end if;
  if nullif(trim(p_subject), '') is null or nullif(trim(p_body), '') is null then raise exception 'Missing draft content'; end if;
  update public.email_drafts d set
    subject = p_subject, body = p_body, status = p_content_state, content_state = p_content_state,
    content_revision = d.content_revision + 1, approved_at = null, excluded_at = null,
    failure_code = null, generated_at = now(), review_claim_token = null,
    review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.content_revision = p_expected_revision
    and d.review_claim_token = p_token and d.review_claim_expires_at >= now()
    and d.status = d.review_claim_status and d.status in ('generated', 'edited', 'approved')
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = p_user_id and c.status = 'draft');
  return found;
end;
$$;

create function public.release_review_ai_admin(p_user_id uuid, p_draft_id uuid, p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  update public.email_drafts d set review_claim_token = null, review_claim_expires_at = null, review_claim_status = null
  where d.id = p_draft_id and d.review_claim_token = p_token
    and exists (select 1 from public.campaigns c where c.id = d.campaign_id and c.user_id = p_user_id);
end;
$$;

revoke all on function public.claim_campaign_drafts_admin(uuid, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.complete_campaign_draft_admin(uuid, uuid, uuid, bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.edit_email_draft(uuid, bigint, text, text) from public, anon;
revoke all on function public.approve_email_draft(uuid, bigint) from public, anon;
revoke all on function public.approve_all_email_drafts(uuid) from public, anon;
revoke all on function public.exclude_email_draft(uuid, bigint) from public, anon;
revoke all on function public.restore_email_draft(uuid, bigint) from public, anon;
revoke all on function public.claim_review_ai(uuid, bigint) from public, anon;
revoke all on function public.complete_review_ai_admin(uuid, uuid, uuid, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.release_review_ai_admin(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_campaign_drafts_admin(uuid, uuid, integer, boolean) to service_role;
grant execute on function public.complete_campaign_draft_admin(uuid, uuid, uuid, bigint, text, text, text, text) to service_role;
grant execute on function public.edit_email_draft(uuid, bigint, text, text) to authenticated;
grant execute on function public.approve_email_draft(uuid, bigint) to authenticated;
grant execute on function public.approve_all_email_drafts(uuid) to authenticated;
grant execute on function public.exclude_email_draft(uuid, bigint) to authenticated;
grant execute on function public.restore_email_draft(uuid, bigint) to authenticated;
grant execute on function public.claim_review_ai(uuid, bigint) to authenticated;
grant execute on function public.complete_review_ai_admin(uuid, uuid, uuid, bigint, text, text, text) to service_role;
grant execute on function public.release_review_ai_admin(uuid, uuid, uuid) to service_role;
