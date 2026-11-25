-- Rentautos: elimina el almacenamiento de la revisión diaria de flota retirada.
-- Es seguro ejecutarlo si la tabla no existe.

drop table if exists public.receivables_daily_fleet_reviews_cloud;

