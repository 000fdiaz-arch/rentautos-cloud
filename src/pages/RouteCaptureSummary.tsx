import { useMemo } from "react";
import { getBusinessDateKey } from "../billing";
import type { RouteCaptureEvent, RouteRun } from "../cloud/routeCaptureCloudData";
import { formatRouteDateTime } from "../routeTimeUrgency";

type Props = {
  events: RouteCaptureEvent[];
  runs: RouteRun[];
  businessDateKey: string;
  currentUserId?: string;
  operatorRoute?: string;
  canStartRoute: boolean;
  canConfirm: boolean;
  savingId: string | null;
  runSavingId: string | null;
  onConfirm: (event: RouteCaptureEvent) => void;
  onSubmitRoute: (run: RouteRun) => void;
  onConfirmRoute: (run: RouteRun) => void;
};

const KNOWN_DELTAS = [
  { email: "delta1@auth.rentautos.local", label: "Delta 1", route: "PTY" },
  { email: "delta2@auth.rentautos.local", label: "Delta 2", route: "WC" },
  { email: "delta3@auth.rentautos.local", label: "Delta 3", route: "PTY" }
] as const;

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function operatorLabel(value: string): string {
  const email = normalizedEmail(value);
  const known = KNOWN_DELTAS.find((delta) => delta.email === email);
  if (known) return known.label;
  const login = email.split("@")[0] || "Usuario";
  return login.replace(/^delta\s*(\d+)$/i, "Delta $1");
}

export default function RouteCaptureSummary({ events, runs, businessDateKey, currentUserId, operatorRoute, canStartRoute, canConfirm, savingId, runSavingId, onConfirm, onSubmitRoute, onConfirmRoute }: Props) {
  const todayEvents = useMemo(() => events.filter((event) => {
    const date = new Date(event.reported_at);
    return !Number.isNaN(date.getTime()) && getBusinessDateKey(date) === businessDateKey;
  }), [businessDateKey, events]);

  const rows = useMemo(() => {
    const knownRows = KNOWN_DELTAS.map((delta) => ({
      key: delta.email,
      label: delta.label,
      route: delta.route,
      events: todayEvents.filter((event) => normalizedEmail(event.reporter_name) === delta.email)
    }));
    const knownEmails = new Set<string>(KNOWN_DELTAS.map((delta) => delta.email));
    const other = new Map<string, RouteCaptureEvent[]>();
    todayEvents.forEach((event) => {
      const email = normalizedEmail(event.reporter_name);
      if (knownEmails.has(email)) return;
      other.set(email, [...(other.get(email) ?? []), event]);
    });
    return [
      ...knownRows,
      ...Array.from(other.entries()).map(([email, operatorEvents]) => ({
        key: email,
        label: operatorLabel(email),
        route: operatorEvents[0]?.route_assignment || "Sin ruta",
        events: operatorEvents
      }))
    ];
  }, [todayEvents]);

  const pending = events.filter((event) => event.status === "pending");
  const activeRun = runs.find((run) => run.operator_id === currentUserId && run.status === "in_progress");
  const submittedRun = runs.find((run) => run.operator_id === currentUserId && run.status === "pending");
  const pendingRuns = runs.filter((run) => run.status === "pending");

  const capturesForRun = (runId: string) => events.filter((event) => event.route_run_id === runId).length;

  return <section className="route-capture-summary" aria-label="Control de captaciones">
    <div className="route-capture-summary-head">
      <div><strong>Control de captaciones</strong><span>Resultados de hoy por Delta</span></div>
      <b>{todayEvents.filter((event) => event.status === "confirmed").length} confirmadas</b>
    </div>
    {operatorRoute && canStartRoute ? <div className="route-run-control">
      <div>
        <strong>Ruta {operatorRoute}</strong>
        <span>{activeRun ? `En curso desde ${formatRouteDateTime(activeRun.started_at)} · ${capturesForRun(activeRun.id)} captaciones` : submittedRun ? "Enviada para confirmación administrativa" : "Se iniciará automáticamente con la primera captación"}</span>
      </div>
      {activeRun ? <button type="button" className="button primary small" disabled={runSavingId !== null} onClick={() => onSubmitRoute(activeRun)}>
        {runSavingId === activeRun.id ? "Cerrando…" : "Cerrar y enviar"}
      </button> : null}
    </div> : null}
    <div className="route-capture-summary-table" role="table" aria-label="Captaciones de hoy por Delta">
      <div className="route-capture-summary-row route-capture-summary-row--head" role="row">
        <span>Delta</span><span>Ruta</span><span>Reportadas</span><span>Pendientes</span><span>Confirmadas</span>
      </div>
      {rows.map((row) => <div className="route-capture-summary-row" role="row" key={row.key}>
        <strong>{row.label}</strong>
        <span>{row.route}</span>
        <b>{row.events.length}</b>
        <b className={row.events.some((event) => event.status === "pending") ? "is-pending" : ""}>{row.events.filter((event) => event.status === "pending").length}</b>
        <b className="is-confirmed">{row.events.filter((event) => event.status === "confirmed").length}</b>
      </div>)}
    </div>
    {canConfirm && pendingRuns.length > 0 ? <details className="route-capture-pending route-run-pending" open>
      <summary>Rutas por confirmar ({pendingRuns.length})</summary>
      <div className="route-capture-pending-list">
        {pendingRuns.map((run) => <article key={run.id}>
          <div>
            <strong>{operatorLabel(run.operator_name)} · Ruta {run.route_assignment}</strong>
            <span>{capturesForRun(run.id)} captaciones · {events.filter((event) => event.route_run_id === run.id && event.status === "pending").length} por confirmar · Iniciada {formatRouteDateTime(run.started_at)}</span>
            {run.submitted_at ? <small>Cerrada {formatRouteDateTime(run.submitted_at)}</small> : null}
          </div>
          <button type="button" className="button primary small" disabled={runSavingId !== null} onClick={() => onConfirmRoute(run)}>
            {runSavingId === run.id ? "Confirmando…" : "Confirmar ruta"}
          </button>
        </article>)}
      </div>
    </details> : null}
    <details className="route-capture-pending" open={canConfirm && pending.length > 0}>
      <summary>Pendientes de confirmar ({pending.length})</summary>
      {pending.length === 0 ? <p>No hay captaciones pendientes de validación.</p> : <div className="route-capture-pending-list">
        {pending.map((event) => <article key={event.id}>
          <div>
            <strong>{event.unit_id} · {event.client_name}</strong>
            <span>{operatorLabel(event.reporter_name)} · Ruta {event.route_assignment || "Sin ruta"}</span>
            <small>Reportada {formatRouteDateTime(event.reported_at)}</small>
          </div>
          {canConfirm ? <button type="button" className="button primary small" disabled={savingId !== null} onClick={() => onConfirm(event)}>
            {savingId === event.id ? "Confirmando…" : "Confirmar captación"}
          </button> : <span className="route-capture-pending-badge">Pendiente de administración</span>}
        </article>)}
      </div>}
    </details>
  </section>;
}
