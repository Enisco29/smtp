create or replace function public.claim_campaign_drafts_admin(
  p_user_id uuid,
  p_campaign_id uuid,
  p_limit integer,
  p_retry_failed boolean default false
)
returns table (
  draft_id uuid,
  recipient_id uuid,
  recipient_email text,
  recipient_data jsonb,
  token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden';
  end if;

  if p_limit < 1 or p_limit > 8 then
    raise exception 'Invalid batch size';
  end if;

  perform 1
  from public.campaigns c
  where c.id = p_campaign_id
    and c.user_id = p_user_id
    and c.status = 'draft'
  for update;

  if not found then
    raise exception 'Draft campaign not found';
  end if;

  insert into public.email_drafts (
    campaign_id,
    recipient_id
  )
  select
    p_campaign_id,
    r.id
  from public.recipients r
  where r.campaign_id = p_campaign_id
  on conflict on constraint email_drafts_campaign_id_recipient_id_key
  do nothing;

  if p_retry_failed then
    update public.email_drafts d
    set
      status = 'pending',
      failure_code = null
    where d.campaign_id = p_campaign_id
      and d.status = 'failed';
  end if;

  update public.email_drafts d
  set
    status = 'pending',
    claim_token = null,
    claim_expires_at = null
  where d.campaign_id = p_campaign_id
    and d.status = 'processing'
    and d.claim_expires_at < now();

  return query
  with picked as (
    select d.id
    from public.email_drafts d
    where d.campaign_id = p_campaign_id
      and d.status = 'pending'
    order by d.updated_at, d.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.email_drafts d
    set
      status = 'processing',
      claim_token = gen_random_uuid(),
      claim_expires_at = now() + interval '3 minutes'
    from picked p
    where d.id = p.id
    returning
      d.id,
      d.recipient_id,
      d.claim_token
  )
  select
    c.id,
    c.recipient_id,
    r.email,
    r.data,
    c.claim_token
  from claimed c
  join public.recipients r
    on r.id = c.recipient_id;
end;
$$;