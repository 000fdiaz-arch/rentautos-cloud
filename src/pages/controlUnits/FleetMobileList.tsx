import { memo } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { optionalString } from "./controlUnitsRules";
import { FleetStatusControl } from "./FleetStatusControl";

type Props = {
  rows: ControlUnitRow[];
  readOnly: boolean;
  canEditStatus: boolean;
  onEditUnit: (row: ControlUnitRow) => void;
  onRenameUnit: (row: ControlUnitRow) => void;
  onRetireUnit: (row: ControlUnitRow) => void;
  onShowHistory: (row: ControlUnitRow) => void;
  onOpenStatusDialog: (row: ControlUnitRow) => void;
};

export const FleetMobileList = memo(function FleetMobileList({
  rows,
  readOnly,
  canEditStatus,
  onEditUnit,
  onRenameUnit,
  onRetireUnit,
  onShowHistory,
  onOpenStatusDialog
}: Props) {
  return (
    <div className="fleet-mobile-list">
      {rows.length === 0 ? (
        <p className="empty">No hay unidades para los filtros seleccionados.</p>
      ) : (
        rows.map((row) => {
          const year = optionalString(row, ["year", "model_year"]);
          const color = optionalString(row, ["color"]);
          const transmission = optionalString(row, ["transmission", "transmission_type"]);
          const mileage = optionalString(row, ["mileage", "kilometraje", "kilometrage"]);
          return (
            <article className="fleet-mobile-card" key={`mobile-${row.fleet_id || `${row.user_id}-${row.unit_id}`}`}>
              <div className="fleet-mobile-card-head">
                <div>
                  <span className="fleet-mobile-kicker">Unidad</span>
                  <strong>{row.unit_id}</strong>
                </div>
                <FleetStatusControl
                  row={row}
                  readOnly={readOnly}
                  canEditStatus={canEditStatus}
                  onOpenStatusDialog={onOpenStatusDialog}
                />
              </div>
              <div className="fleet-mobile-main">
                <span>{row.brand_model ?? "Sin marca/modelo"}</span>
                <span>{row.plate ? `Placa ${row.plate}` : "Sin placa"}</span>
              </div>
              <dl className="fleet-mobile-details">
                <div><dt>Empresa</dt><dd>{row.company ?? "-"}</dd></div>
                <div><dt>Ano</dt><dd>{year || "-"}</dd></div>
                <div><dt>Color</dt><dd>{color || "-"}</dd></div>
                <div><dt>Km</dt><dd>{mileage || "-"}</dd></div>
              </dl>
              <details className="fleet-mobile-tech">
                <summary>Ficha tecnica</summary>
                <dl className="fleet-mobile-details">
                  <div><dt>Motor</dt><dd>{row.engine_serial ?? "-"}</dd></div>
                  <div><dt>Chasis</dt><dd>{row.chassis_serial ?? "-"}</dd></div>
                  <div><dt>Transmision</dt><dd>{transmission || "-"}</dd></div>
                </dl>
                {row.observation && <p className="fleet-mobile-note">{row.observation}</p>}
              </details>
              {!readOnly && (
                <div className="panel-actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
                  <button type="button" className="button ghost small fleet-mobile-edit" onClick={() => onEditUnit(row)}>Editar</button>
                  <button type="button" className="button ghost small" onClick={() => onRenameUnit(row)}>Cambiar nomenclatura</button>
                  <button type="button" className="button ghost small" onClick={() => onRetireUnit(row)}>Dar de baja</button>
                  <button type="button" className="button ghost small" onClick={() => onShowHistory(row)}>Historial</button>
                </div>
              )}
            </article>
          );
        })
      )}
    </div>
  );
});
