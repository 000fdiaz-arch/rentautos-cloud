-- Rentautos: asegurar que vw_control_unidades respete RLS del usuario invocador.
-- Corrige el aviso de Supabase Advisor "Security Definer View".

alter view public.vw_control_unidades
  set (security_invoker = true);
