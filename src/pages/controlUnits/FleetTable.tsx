import { memo } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { optionalString, toGroup, type SortField } from "./controlUnitsRules";
import { FleetStatusControl } from "./FleetStatusControl";

type Props = {
  rows: ControlUnitRow[];
  readOnly: boolean;
  canEditStatus: boolean;
  onToggleSort: (field: SortField) => void;
  onEditUnit: (row: ControlUnitRow) => void;
  onRenameUnit: (row: ControlUnitRow) => void;
  onRetireUnit: (row: ControlUnitRow) => void;
  onShowHistory: (row: ControlUnitRow) => void;
  onOpenStatusDialog: (row: ControlUnitRow) => void;
};

export const FleetTable = memo(function FleetTable({
  rows,
  readOnly,
  canEditStatus,
  onToggleSort,
  onEditUnit,
  onRenameUnit,
  onRetireUnit,
  onShowHistory,
  onOpenStatusDialog
}: Props) {
  return (
    <div className="table-scroll fleet-table-scroll">
      <table className="ar-table">
        <thead>
          <tr>
            <th><button type="button" className="sort-button" onClick={() => onToggleSort("unit_id")}>Unidad</button></th>
            <th><button type="button" className="sort-button" onClick={() => onToggleSort("group")}>Grupo</button></th>
            <th><button type="button" className="sort-button" onClick={() => onToggleSort("operational_status")}>Estado</button></th>
            <th><button type="button" className="sort-button" onClick={() => onToggleSort("brand_model")}>Marca / Modelo</button></th>
            <th>Ano</th>
            <th><button type="button" className="sort-button" onClick={() => onToggleSort("company")}>Empresa</button></th>
            <th><button type="button" className="sort-button" onClick={() => onToggleSort("plate")}>Placa</button></th>
            <th>Motor</th>
            <th>Chasis</th>
            <th>Color</th>
            <th>Transmision</th>
            <th>Kilometraje</th>
            <th>Observacion</th>
            {!readOnly && <th>Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={readOnly ? 13 : 14}><span className="hint">No hay unidades para los filtros seleccionados.</span></td>
            </tr>
          ) : (
            rows.map((row) => {
              const year = optionalString(row, ["year", "model_year"]);
              const color = optionalString(row, ["color"]);
              const transmission = optionalString(row, ["transmission", "transmission_type"]);
              const mileage = optionalString(row, ["mileage", "kilometraje", "kilometrage"]);
              return (
                <tr key={row.fleet_id || `${row.user_id}-${row.unit_id}`}>
                  <td><strong>{row.unit_id}</strong></td>
                  <td>{toGroup(row.unit_id ?? "")}</td>
                  <td>
                    <FleetStatusControl
                      row={row}
                      readOnly={readOnly}
                      canEditStatus={canEditStatus}
                      onOpenStatusDialog={onOpenStatusDialog}
                    />
                  </td>
                  <td>{row.brand_model ?? "-"}</td>
                  <td>{year || "-"}</td>
                  <td>{row.company ?? "-"}</td>
                  <td>{row.plate ?? "-"}</td>
                  <td>{row.engine_serial ?? "-"}</td>
                  <td>{row.chassis_serial ?? "-"}</td>
                  <td>{color || "-"}</td>
                  <td>{transmission || "-"}</td>
                  <td>{mileage || "-"}</td>
                  <td className="ar-truncate-line" title={row.observation ?? ""}>{row.observation ?? "-"}</td>
                  {!readOnly && (
                    <td>
                      <div className="panel-actions" style={{ flexWrap: "wrap" }}>
                        <button type="button" className="button ghost small" onClick={() => onEditUnit(row)}>Editar</button>
                        <button type="button" className="button ghost small" onClick={() => onRenameUnit(row)}>Cambiar nomenclatura</button>
                        <button type="button" className="button ghost small" onClick={() => onRetireUnit(row)}>Dar de baja</button>
                        <button type="button" className="button ghost small" onClick={() => onShowHistory(row)}>Historial</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
});
