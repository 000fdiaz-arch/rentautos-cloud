import { memo } from "react";
import type { FleetPieSlice } from "./controlUnitsRules";

type Props = {
  kpiTotal: number;
  pieData: { slices: FleetPieSlice[]; total: number };
  statusFilter: string;
  onStatusFilterChange: (updater: string | ((current: string) => string)) => void;
};

export const FleetDashboard = memo(function FleetDashboard({
  kpiTotal,
  pieData,
  statusFilter,
  onStatusFilterChange
}: Props) {
  return (
    <div className="summary-grid fleet-summary-grid">
      <article className="summary-card">
        <span>Total flota</span>
        <strong>{kpiTotal}</strong>
        <p className="hint" style={{ marginTop: 6 }}>
          Click en una porcion para filtrar por estado.
        </p>
        <div className="fleet-dashboard-layout">
          <div className="fleet-chart-wrap">
            <svg className="fleet-chart" viewBox="0 0 240 240" role="img" aria-label="Distribucion de estados de flota">
              {pieData.slices.map((slice) => {
                const active = statusFilter === slice.key;
                return (
                  <path
                    key={slice.key}
                    d={slice.path}
                    fill={slice.color}
                    stroke={active ? "#0f172a" : "#ffffff"}
                    strokeWidth={active ? 3 : 1.5}
                    style={{ cursor: "pointer", opacity: statusFilter === "all" || active ? 1 : 0.45 }}
                    onClick={() => onStatusFilterChange((current) => (current === slice.key ? "all" : slice.key))}
                  />
                );
              })}
              <circle cx="120" cy="120" r="46" fill="#ffffff" />
              <text x="120" y="113" textAnchor="middle" fontSize="12" fill="#64748b">Estados</text>
              <text x="120" y="132" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a">{pieData.total}</text>
            </svg>
          </div>
          <div className="fleet-status-list">
            <button
              type="button"
              className={`button ghost small fleet-status-filter ${statusFilter === "all" ? "cash-tab-active" : ""}`}
              onClick={() => onStatusFilterChange("all")}
            >
              Ver todos
            </button>
            {pieData.slices.map((slice) => (
              <button
                key={slice.key}
                type="button"
                className={`button ghost small fleet-status-filter ${statusFilter === slice.key ? "cash-tab-active" : ""}`}
                onClick={() => onStatusFilterChange((current) => (current === slice.key ? "all" : slice.key))}
              >
                <span className="fleet-status-filter-label">
                  <span className="fleet-color-dot" style={{ background: slice.color }} />
                  {slice.label}
                </span>
                <strong>{slice.count} ({slice.percent.toFixed(1)}%)</strong>
              </button>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
});
