import { ROUTE_DELTAS, type RouteDeltaKey, type RouteManagedAction } from "../routeDeltaTracking";

type Props = {
  actions: RouteManagedAction[];
  activeDelta: RouteDeltaKey | null;
  activeRoute: string;
  onDeltaChange: (delta: RouteDeltaKey) => void;
  locked?: boolean;
};

function normalizedRoute(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export default function RouteTeamSummary({ actions, activeDelta, activeRoute, onDeltaChange, locked = false }: Props) {
  const route = normalizedRoute(activeRoute);
  const rows = ROUTE_DELTAS.map((delta) => {
    const deltaActions = actions.filter((action) => action.delta === delta.key && (!route || normalizedRoute(action.routeAssignment) === route));
    return {
      ...delta,
      received: deltaActions.length,
      paid: deltaActions.filter((action) => action.kind === "paid").length,
      remote: deltaActions.filter((action) => action.kind === "remote").length,
      custody: deltaActions.filter((action) => action.kind === "custody").length,
    };
  }).filter((row) => !activeDelta || row.key === activeDelta);
  const received = rows.reduce((total, row) => total + row.received, 0);

  return <section className="route-team-summary" aria-label="Resumen del equipo">
    <div className="route-team-summary-head">
      <div><strong>Resumen del equipo</strong><span>Carros únicos gestionados hoy por Delta</span></div>
      <b>{received} recibidas</b>
    </div>
    <div className="route-team-summary-table" role="table" aria-label="Resultados de los tres Deltas">
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
      </button>)}
    </div>
  </section>;
}
