import { getBusinessDateKey } from "../../billing";
import { supabase } from "../../lib/supabase";

export type OperationalReview = {
  id: string; user_id: string; unit_id: string; previous_status: string; status: string;
  collector: string; reviewed_by: string; reviewed_at: string; fleet_updated_at: string;
};
export function needsOperationalReview(status: string) {
  return status.trim().toLowerCase() !== "activo";
}
export function operationalReviewConfirmed(review: OperationalReview | undefined, status: string, collector: string, today: string, fleetUpdatedAt?: string) {
  return !!review && review.status === status.trim().toLowerCase() && review.collector === collector
    && getBusinessDateKey(new Date(review.reviewed_at)) === today
    && (!fleetUpdatedAt || Date.parse(review.fleet_updated_at) === Date.parse(fleetUpdatedAt));
}
export async function saveOperationalReview(owner: string, unit: string, expected: string, status: string, collector: string) {
  if (!supabase) throw new Error("No hay conexión con la base de datos.");
  const { data, error } = await supabase.rpc("cxc_v2_validate_receivable_unit_status", {
    p_owner: owner, p_unit: unit, p_expected_status: expected, p_status: status, p_collector: collector
  });
  if (error) throw error;
  const review = data?.review as OperationalReview | undefined;
  if (!review?.id) throw new Error("La base de datos no confirmó la validación.");
  // A second read with the collector's actual permissions confirms the committed record.
  const confirmed = await supabase.from("cxc_v2_receivables_operational_reviews").select("*")
    .eq("user_id", owner).eq("id", review.id).single();
  if (confirmed.error) throw confirmed.error;
  if (confirmed.data.status !== status || confirmed.data.collector !== collector || confirmed.data.unit_id !== unit.trim().toUpperCase())
    throw new Error("No se pudo confirmar el estado guardado. Recarga y vuelve a verificar.");
  return { review: confirmed.data as OperationalReview, archivedIds: data.archived_client_ids as string[], updatedIds: data.updated_client_ids as string[] };
}
