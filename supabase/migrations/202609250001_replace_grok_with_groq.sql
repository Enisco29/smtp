-- xAI/Grok credentials cannot authenticate to Groq. Do not relabel old keys.
begin;

alter table public.profiles drop constraint profiles_active_ai_provider_check;
alter table public.ai_provider_keys drop constraint ai_provider_keys_provider_check;

update public.profiles set active_ai_provider = null where active_ai_provider = 'grok';
-- Cascades to private.ai_provider_secrets; generated email drafts are untouched.
delete from public.ai_provider_keys where provider = 'grok';

alter table public.profiles add constraint profiles_active_ai_provider_check
  check (active_ai_provider in ('openai', 'groq', 'claude', 'gemini'));
alter table public.ai_provider_keys add constraint ai_provider_keys_provider_check
  check (provider in ('openai', 'groq', 'claude', 'gemini'));

create or replace function public.manage_ai_provider_admin(
  p_user_id uuid, p_provider text, p_operation text, p_encrypted_key text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Forbidden'; end if;
  if p_provider is null or p_provider not in ('openai', 'groq', 'claude', 'gemini') then
    raise exception 'Invalid provider';
  end if;
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

revoke all on function public.manage_ai_provider_admin(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.manage_ai_provider_admin(uuid, text, text, text) to service_role;

commit;
