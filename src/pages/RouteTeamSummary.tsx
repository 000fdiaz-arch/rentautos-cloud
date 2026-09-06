import type { ActiveRouteItem } from "../cloudData";
import type { RoutePaymentReport } from "../cloud/routeReportCloudData";

type Props = {
  workItems: ActiveRouteItem[];
  reports: RoutePaymentReport[];
  confirmedToday: RoutePaymentReport[];
};

export default function RouteTeamSummary({ workItems, reports, confirmedToday }: Props) {
  return <section className="route-team-summary" aria-label="Resumen del equipo">
    <strong className="route-team-summary-title">Resumen del equipo</strong>
    <div className="route-team-summary-rows">
      {(["WC", "PTY"] as const).map((team) => {
        const teamWork = workItems.filter((item) => item.routeAssignment === team);
        const inactive = teamWork.filter((item) => item.routeInactiveAt).length;
        const pending = teamWork.length - inactive;
        const review = reports.filter((report) => report.status === "review" && report.snapshot.routeAssignment === team).length;
        const confirmed = confirmedToday.filter((report) => report.snapshot.routeAssignment === team).length;
        return <div className="route-team-summary-row" key={team}>
          <b>{team}</b>
          <span><strong>{pending}</strong><small>Por visitar</small></span>
          <span className={inactive > 0 ? "has-inactive" : ""}><strong>{inactive}</strong><small>Inactivos</small></span>
          <span><strong>{review}</strong><small>Revisión</small></span>
          <span><strong>{confirmed}</strong><small>Confirmados hoy</small></span>
        </div>;
      })}
    </div>
  </section>;
}
