import { memo } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { getFleetCompleteness, normalizeText, optionalString } from "./controlUnitsRules";

type Props = {
  rows: ControlUnitRow[];
  totalFleet: number;
  readOnly: boolean;
  onEdit: (row: ControlUnitRow) => void;
};

function hasCatalogValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isCatalogReady(row: ControlUnitRow): boolean {
  return Boolean(normalizeText(row.catalog_photo_path)) &&
    hasCatalogValue(row.catalog_contract_months) &&
    hasCatalogValue(row.catalog_daily_rate) &&
    hasCatalogValue(row.catalog_weekly_rate) &&
    hasCatalogValue(row.catalog_biweekly_rate) &&
    hasCatalogValue(row.catalog_daily_management_fee) &&
    hasCatalogValue(row.catalog_weekly_management_fee) &&
    hasCatalogValue(row.catalog_biweekly_management_fee);
}

export const FleetIncompleteList = memo(function FleetIncompleteList({ rows, totalFleet, readOnly, onEdit }: Props) {
  const criticalCount = rows.filter((row) => getFleetCompleteness(row).criticalMissing.length > 0).length;
  const completeCount = Math.max(0, totalFleet - rows.length);

  return (
    <>
      <div className="fleet-incomplete-kpis">
        <article><span>Fichas completas</span><strong>{completeCount}</strong><small>de {totalFleet} autos activos</small></article>
        <article className="is-warning"><span>Pendientes</span><strong>{rows.length}</strong><small>requieren uno o más datos</small></article>
        <article className="is-critical"><span>Identidad incompleta</span><strong>{criticalCount}</strong><small>falta placa, motor o chasis</small></article>
      </div>

      {rows.length === 0 ? (
        <div className="fleet-incomplete-empty"><strong>Todo está completo.</strong><p>No hay autos pendientes para los filtros seleccionados.</p></div>
      ) : (
        <div className="fleet-incomplete-list">
          {rows.map((row) => {
            const completeness = getFleetCompleteness(row);
            const catalogReady = isCatalogReady(row);
            return (
              <article className="fleet-incomplete-card" key={row.fleet_id || row.unit_id}>
                <div className="fleet-incomplete-main">
                  <span className="fleet-incomplete-unit">{row.unit_id}</span>
                  <div>
                    <strong>{normalizeText(row.brand_model) || "Auto sin modelo"}</strong>
                    <small>{normalizeText(row.plate) ? `Placa ${row.plate}` : "Sin placa"} · {optionalString(row, ["year", "model_year"]) || "Año pendiente"}</small>
                  </div>
                </div>

                <div className="fleet-incomplete-progress" aria-label={`${completeness.completed} de ${completeness.total} datos completos`}>
                  <div><strong>{completeness.completed}/{completeness.total}</strong><span>{completeness.percent}%</span></div>
                  <span><i style={{ width: `${completeness.percent}%` }} /></span>
                </div>

                <div className="fleet-incomplete-missing">
                  {completeness.missing.map((field) => (
                    <span className={completeness.criticalMissing.includes(field) ? "is-critical" : ""} key={field}>{field}</span>
                  ))}
                </div>

                <div className="fleet-incomplete-actions">
                  <span className={`fleet-catalog-readiness ${catalogReady ? "is-ready" : ""}`}>
                    {catalogReady ? "Catálogo listo" : "Catálogo pendiente"}
                  </span>
                  {!readOnly && <button type="button" className="button primary small" onClick={() => onEdit(row)}>Completar ficha</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
});
