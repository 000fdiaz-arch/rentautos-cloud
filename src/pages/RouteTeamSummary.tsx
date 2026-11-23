import { useEffect, useState } from "react";
import { ROUTE_DELTAS, type RouteDeltaKey, type RouteManagedAction } from "../routeDeltaTracking";
import { formatCurrency } from "../format";
import { supabase } from "../lib/supabase";

type Props = {
  dataOwnerUserId?: string | null;
  actions: RouteManagedAction[];
  activeDelta: RouteDeltaKey | null;
  activeRoute: string;
  onDeltaChange: (delta: RouteDeltaKey) => void;
  locked?: boolean;
};

function normalizedRoute(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export default function RouteTeamSummary({ dataOwnerUserId, actions, activeDelta, activeRoute, onDeltaChange, locked = false }: Props) {
  const [inactiveDeltas, setInactiveDeltas] = useState<RouteDeltaKey[]>([]);
  useEffect(() => {
    setInactiveDeltas([]);
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    let disposed = false;
    let requestId = 0;
    async function reloadAvailability() {
      const id = ++requestId;
      try {
        const { data, error } = await client.from("user_profiles")
          .select("id,email,is_active,data_owner_user_id")
          .in("email", ROUTE_DELTAS.map(delta => delta.email))
          .or(`data_owner_user_id.eq.${dataOwnerUserId},id.eq.${dataOwnerUserId}`);
        if (error) throw error;
        if (disposed || id !== requestId) return;
        const ownerProfiles = (data ?? []).filter(profile => (profile.data_owner_user_id ?? profile.id) === dataOwnerUserId);
        // Only hide a Delta when its account is explicitly disabled. An account
        // outside the current user's profile-reading scope has unknown status.
        setInactiveDeltas(ROUTE_DELTAS.filter(delta => ownerProfiles.some(profile =>
          profile.email?.trim().toLowerCase() === delta.email && profile.is_active === false)).map(delta => delta.key));
      } catch (error) {
        if (!disposed && id === requestId) console.warn("No se pudo actualizar la disponibilidad del equipo de ruta.", error);
      }
    }
    const refresh = () => { if (document.visibilityState === "visible") void reloadAvailability(); };
    void reloadAvailability();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [dataOwnerUserId]);
  const route = normalizedRoute(activeRoute);
  const rows = ROUTE_DELTAS.filter(delta => !inactiveDeltas.includes(delta.key)).map((delta) => {
    const deltaActions = actions.filter((action) => action.delta === delta.key && (!route || normalizedRoute(action.routeAssignment) === route));
    return {
      ...delta,
      received: deltaActions.length,
      paid: deltaActions.filter((action) => action.kind === "paid").length,
      remote: deltaActions.filter((action) => action.kind === "remote").length,
      custody: deltaActions.filter((action) => action.kind === "custody").length,
      routeCash: deltaActions.filter(action => !action.outsideRoute).reduce((sum, action) => sum + action.cashAmount, 0),
      outsideCash: deltaActions.filter(action => action.outsideRoute).reduce((sum, action) => sum + action.cashAmount, 0),
    };
  }).filter((row) => !activeDelta || row.key === activeDelta);
  const received = rows.reduce((total, row) => total + row.received, 0);

  return <section className="route-team-summary" aria-label="Resumen del equipo">
    <div className="route-team-summary-head">
      <div><strong>Resumen del equipo</strong><span>Gestiones de hoy por Delta · En ruta y fuera de ruta</span></div>
      <b>{received} recibidas</b>
    </div>
    <div className="route-team-summary-table" role="table" aria-label="Resultados del equipo activo">
      <div className="route-team-summary-row route-team-summary-row--head" role="row">
        <span>Grupo</span><span>Recibidas</span><span>Cobrado</span><span>Gestión remota</span><span>Custodia</span>
      </div>
      {rows.map((row) => <button type="button" className={`route-team-summary-row${activeDelta === row.key ? " is-selected" : ""}`} key={row.key}
        aria-pressed={activeDelta === row.key} disabled={locked} onClick={() => onDeltaChange(row.key)}>
        <span className="route-team-summary-delta"><strong>{row.label}</strong><small>Ruta {row.route}{locked ? " · Tu actividad" : " · Toca para filtrar"}</small></span>
        <b data-label="Recibidas">{row.received}</b>
        <b data-label="Cobrado">{row.paid}</b>
        <b data-label="Gestión remota">{row.remote}</b>
        <b data-label="Custodia">{row.custody}</b>
        <span className="route-team-cash-breakdown">Efectivo: {formatCurrency(row.routeCash + row.outsideCash)} · En ruta {formatCurrency(row.routeCash)} · Fuera de ruta {formatCurrency(row.outsideCash)}</span>
      </button>)}
    </div>
  </section>;
}
