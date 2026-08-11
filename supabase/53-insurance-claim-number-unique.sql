-- Impide números de reclamo repetidos por owner, incluso ante guardados simultáneos.
-- Los espacios, guiones y diferencias entre mayúsculas/minúsculas no crean números distintos.

create or replace function public.prevent_duplicate_insurance_claim_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_claim_number text;
begin
  normalized_claim_number := upper(regexp_replace(coalesce(new.data ->> 'claimNumber', ''), '[[:space:]-]+', '', 'g'));
  if normalized_claim_number = '' then
    return new;
  end if;

  -- Serializa intentos concurrentes para el mismo owner y número de reclamo.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || normalized_claim_number, 0));

  if exists (
    select 1
    from public.insurance_claims_cloud existing
    where existing.user_id = new.user_id
      and existing.id <> new.id
      and upper(regexp_replace(coalesce(existing.data ->> 'claimNumber', ''), '[[:space:]-]+', '', 'g')) = normalized_claim_number
  ) then
    raise exception 'El número de reclamo % ya está registrado.', new.data ->> 'claimNumber'
      using errcode = '23505', constraint = 'insurance_claims_cloud_user_claim_number_unique';
  end if;

  return new;
end;
$$;

drop trigger if exists insurance_claims_cloud_unique_claim_number on public.insurance_claims_cloud;
create trigger insurance_claims_cloud_unique_claim_number
before insert or update of user_id, data
on public.insurance_claims_cloud
for each row
execute function public.prevent_duplicate_insurance_claim_number();

revoke all on function public.prevent_duplicate_insurance_claim_number() from public, anon, authenticated;
