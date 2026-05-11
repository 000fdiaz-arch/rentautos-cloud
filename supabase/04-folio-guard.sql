-- Blindaje de folios: evita reutilizar folios ya usados.
-- Ejecutar despues de 02-cloud-data.sql y 03-cloud-extended.sql

-- Extrae folio desde reference de pagos (ej: "FOLIO:12345 | ...")
create or replace function public.extract_payment_folio(reference_text text)
returns text
language sql
immutable
as $$
  select nullif(
    upper(
      regexp_replace(
        coalesce(
          substring(reference_text from 'FOLIO\s*:\s*([^\s|]+)'),
          ''
        ),
        '\s+',
        '',
        'g'
      )
    ),
    ''
  );
$$;

-- Folio unico por usuario en pagos_cloud (si el pago trae folio)
create unique index if not exists payments_cloud_user_folio_uq
on public.payments_cloud (
  user_id,
  public.extract_payment_folio(data->>'reference')
)
where public.extract_payment_folio(data->>'reference') is not null;

-- Folio unico por usuario en pendientes de banco
create unique index if not exists pending_bank_items_cloud_user_folio_uq
on public.pending_bank_items_cloud (
  user_id,
  upper(regexp_replace(coalesce(data->>'folio', ''), '\s+', '', 'g'))
)
where coalesce(data->>'folio', '') <> '';

-- Folio unico por usuario en pendientes de tarjeta
create unique index if not exists pending_card_items_cloud_user_folio_uq
on public.pending_card_items_cloud (
  user_id,
  upper(regexp_replace(coalesce(data->>'folio', ''), '\s+', '', 'g'))
)
where coalesce(data->>'folio', '') <> '';
