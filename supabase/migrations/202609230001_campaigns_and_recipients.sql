create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  instructions text not null check (char_length(trim(instructions)) > 0),
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_user_created_idx on public.campaigns (user_id, created_at desc);

create table public.recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and char_length(email) > 0),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create index recipients_campaign_created_idx on public.recipients (campaign_id, created_at, id);

create trigger campaigns_set_updated_at before update on public.campaigns
for each row execute function private.set_updated_at();

alter table public.campaigns enable row level security;
alter table public.recipients enable row level security;

create policy "Users read their campaigns" on public.campaigns
for select to authenticated using (user_id = (select auth.uid()));
create policy "Users create draft campaigns" on public.campaigns
for insert to authenticated with check (
  user_id = (select auth.uid()) and status = 'draft'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.onboarding_completed_at is not null)
);
create policy "Users delete their draft campaigns" on public.campaigns
for delete to authenticated using (user_id = (select auth.uid()) and status = 'draft');
create policy "Users read recipients of their campaigns" on public.recipients
for select to authenticated using (
  exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and c.user_id = (select auth.uid())
  )
);

revoke all on public.campaigns from anon, authenticated;
revoke all on public.recipients from anon, authenticated;
grant select, insert, delete on public.campaigns to authenticated;
grant select on public.recipients to authenticated;

create or replace function public.replace_campaign_recipients(
  p_campaign_id uuid,
  p_recipients jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  recipient_count integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_recipients) is distinct from 'array' then
    raise exception 'Recipients must be an array';
  end if;
  recipient_count := jsonb_array_length(p_recipients);
  if recipient_count < 1 or recipient_count > 5000 then
    raise exception 'Recipient count is outside the supported range';
  end if;

  perform 1 from public.campaigns
  where id = p_campaign_id and user_id = actor and status = 'draft'
  for update;
  if not found then raise exception 'Draft campaign not found'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_recipients) item
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'email') is distinct from 'string'
      or jsonb_typeof(item->'data') is distinct from 'object'
      or coalesce(trim(item->>'email'), '') = ''
      or coalesce(lower(trim(item->>'email')), '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then raise exception 'Invalid recipient data'; end if;

  if (
    select count(distinct lower(trim(item->>'email')))
    from jsonb_array_elements(p_recipients) item
  ) <> recipient_count then raise exception 'Duplicate recipient email'; end if;

  delete from public.recipients where campaign_id = p_campaign_id;
  insert into public.recipients (campaign_id, email, data)
  select p_campaign_id, lower(trim(item->>'email')), item->'data'
  from jsonb_array_elements(p_recipients) item;
  update public.campaigns set updated_at = now() where id = p_campaign_id;
  return recipient_count;
end;
$$;

revoke all on function public.replace_campaign_recipients(uuid, jsonb) from public, anon;
grant execute on function public.replace_campaign_recipients(uuid, jsonb) to authenticated;
