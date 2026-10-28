import { memo, useState } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { normalizeText, optionalString } from "./controlUnitsRules";

type Props = {
  rows: ControlUnitRow[];
  readOnly: boolean;
  onEdit: (row: ControlUnitRow) => void;
  onHistory?: (row: ControlUnitRow) => void;
};

function money(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Por definir";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return "Por definir";
  return new Intl.NumberFormat("es-PA", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number);
}

function transmission(row: ControlUnitRow): string {
  const value = optionalString(row, ["transmission", "transmission_type"]);
  return value || "Por definir";
}

function CatalogPhoto({ row, large = false }: { row: ControlUnitRow; large?: boolean }) {
  const photoUrl = normalizeText(row.catalog_photo_url);
  if (photoUrl) {
    return <img className={`fleet-catalog-photo ${large ? "fleet-catalog-photo--large" : ""}`} src={photoUrl} alt={`${normalizeText(row.brand_model) || "Auto"} en catálogo`} />;
  }
  return (
    <div className={`fleet-catalog-photo fleet-catalog-photo--empty ${large ? "fleet-catalog-photo--large" : ""}`} role="img" aria-label="Auto sin foto real asignada">
      <span className="fleet-catalog-photo-icon" aria-hidden="true">📷</span>
      <strong>Sin foto real</strong>
      <small>Abre Editar para tomarla o elegirla</small>
    </div>
  );
}

function Plans({ row, compact = false }: { row: ControlUnitRow; compact?: boolean }) {
  const plans = [
    ["Diario", row.catalog_daily_rate],
    ["Semanal", row.catalog_weekly_rate],
    ["Quincenal", row.catalog_biweekly_rate]
  ] as const;
  return (
    <div className={`fleet-catalog-plans ${compact ? "fleet-catalog-plans--compact" : ""}`}>
      {plans.map(([label, value]) => (
        <div className="fleet-catalog-plan" key={label}>
          <span>{label}</span>
          <strong>{money(value)}</strong>
        </div>
      ))}
    </div>
  );
}

export const FleetCatalog = memo(function FleetCatalog({ rows, readOnly, onEdit, onHistory }: Props) {
  const [detail, setDetail] = useState<ControlUnitRow | null>(null);
  if (rows.length === 0) {
    return (
      <div className="fleet-catalog-empty">
        <strong>No hay autos disponibles en el catálogo.</strong>
        <p>Los autos libres aparecen aquí automáticamente. Los que estén en custodia se publican al cumplir 24 horas.</p>
      </div>
    );
  }

  return (
    <>
      <div className="fleet-catalog-grid">
        {rows.map((row) => (
          <article className="fleet-catalog-card" key={row.fleet_id || row.unit_id}>
            <CatalogPhoto row={row} />
            <div className="fleet-catalog-card-body">
              <h3>{normalizeText(row.brand_model) || "Auto sin modelo"}</h3>
              <p className="fleet-catalog-meta">
                <span>{optionalString(row, ["year", "model_year"]) || "Año por definir"}</span>
                <span aria-hidden="true">·</span>
                <span className="fleet-catalog-transmission"><span aria-hidden="true">⚙</span> {transmission(row)}</span>
              </p>
              <Plans row={row} compact />
              <div className="fleet-catalog-actions">
                <button type="button" className="button primary" onClick={() => setDetail(row)}>Ver ficha</button>
                {!readOnly && <button type="button" className="button ghost" onClick={() => onEdit(row)}>Editar</button>}
              </div>
            </div>
          </article>
        ))}
      </div>

      {detail && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="fleet-catalog-detail-title">
          <div className="modal fleet-catalog-detail-modal">
            <div className="modal-header">
              <div>
                <span className="fleet-catalog-eyebrow">Ficha del auto</span>
                <h2 id="fleet-catalog-detail-title">{normalizeText(detail.brand_model) || "Auto sin modelo"}</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setDetail(null)} aria-label="Cerrar">X</button>
            </div>
            <div className="modal-body fleet-catalog-detail-body">
              <CatalogPhoto row={detail} large />
              <div className="fleet-catalog-detail-info">
                <p className="fleet-catalog-meta fleet-catalog-meta--large">
                  <span>{optionalString(detail, ["year", "model_year"]) || "Año por definir"}</span>
                  <span aria-hidden="true">·</span>
                  <span className="fleet-catalog-transmission"><span aria-hidden="true">⚙</span> {transmission(detail)}</span>
                </p>
                <h3>Planes disponibles</h3>
                <Plans row={detail} />
                <div className="fleet-catalog-actions">
                  {!readOnly && <button type="button" className="button primary" onClick={() => { setDetail(null); onEdit(detail); }}>Editar ficha</button>}
                  {onHistory && <button type="button" className="button ghost" onClick={() => { setDetail(null); onHistory(detail); }}>Ver historial</button>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
