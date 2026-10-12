import { useCallback, useEffect, useState } from "react";
import {
  applyRouteReportDelta,
  loadRoutePaymentReports,
  routeReportDeltaFromPayload,
  type RoutePaymentReport
} from "../../cloud/routeReportCloudData";
import { supabase } from "../../lib/supabase";

export default function useRouteReviewNotifications(dataOwnerUserId?: string | null) {
  const [reports, setReports] = useState<RoutePaymentReport[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const keepNotifiedReport = useCallback((report: RoutePaymentReport) => (
    report.status === "review"
    || (Boolean(report.bank_confirmed_visually_at) && !report.bank_settled_payment_id)
  ), []);
  const upsertRouteReviewReport = useCallback((report: RoutePaymentReport) => {
    setReports((current) => applyRouteReportDelta(current, { id: report.id, report }).filter(keepNotifiedReport));
  }, [keepNotifiedReport]);

  useEffect(() => {
    let active = true;

    async function reload(): Promise<void> {
      if (!dataOwnerUserId) {
        if (active) {
          setReports([]);
          setReady(true);
        }
        return;
      }
      try {
        const next = await loadRoutePaymentReports(dataOwnerUserId, { reviewRelevantOnly: true });
        if (!active) return;
        setReports(next.filter(keepNotifiedReport));
        setError("");
        setReady(true);
      } catch (cause) {
        if (!active) return;
        console.error("No se pudieron cargar los pagos de ruta en revisión.", cause);
        setError("No se pudieron sincronizar los pagos de Ruta en calle.");
      }
    }

    setReady(false);
    void reload();
    if (!dataOwnerUserId || !supabase) return () => { active = false; };

    const channel = supabase
      .channel(`payments-route-reviews-${dataOwnerUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_payment_reports", filter: `user_id=eq.${dataOwnerUserId}` },
        (payload) => {
          const delta = routeReportDeltaFromPayload(payload);
          if (!delta) {
            void reload();
            return;
          }
          setReports((current) => applyRouteReportDelta(current, delta).filter(keepNotifiedReport));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void reload();
      });

    return () => {
      active = false;
      void supabase?.removeChannel(channel);
    };
  }, [dataOwnerUserId, keepNotifiedReport]);

  return { routeReviewReports: reports, routeReviewError: error, routeReviewReady: ready, upsertRouteReviewReport };
}
