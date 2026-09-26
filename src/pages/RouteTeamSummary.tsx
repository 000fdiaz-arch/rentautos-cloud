import type { ActiveRouteItem } from "../cloudData";
import type { RoutePaymentReport } from "../cloud/routeReportCloudData";

type Props = {
  workItems: ActiveRouteItem[];
  reports: RoutePaymentReport[];
  confirmedToday: RoutePaymentReport[];
  routes: string[];
};

function normalizedRoute(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export default function RouteTeamSummary({ workItems, reports, confirmedToday, routes }: Props) {
  const summaryRows = routes.map((team) => {
    const teamWork = workItems.filter((item) => normalizedRoute(item.routeAssignment) === team);
    const inactive = teamWork.filter((item) => item.routeInactiveAt).length;
    const pending = teamWork.length - inactive;
    const review = reports.filter((report) => report.status === "review" && normalizedRoute(report.snapshot.routeAssignment) === team).length;
    const confirmed = confirmedToday.filter((report) => normalizedRoute(report.snapshot.routeAssignment) === team).length;
    return { team, pending, inactive, review, confirmed };
  }).filter((row) => row.pending + row.inactive + row.review + row.confirmed > 0);

  return <section className="route-team-summary" aria-label="Resumen del equipo">
    <strong className="route-team-summary-title">Resumen del equipo</strong>
    <div className="route-team-summary-rows">
      {summaryRows.map((row) => {
        return <div className="route-team-summary-row" key={row.team}>
          <b>{row.team}</b>
          <span><strong>{row.pending}</strong><small>Por visitar</small></span>
          <span className={row.inactive > 0 ? "has-inactive" : ""}><strong>{row.inactive}</strong><small>Inactivos</small></span>
          <span><strong>{row.review}</strong><small>Pago notificado</small></span>
          <span><strong>{row.confirmed}</strong><small>Confirmados hoy</small></span>
        </div>;
      })}
    </div>
  </section>;
}
