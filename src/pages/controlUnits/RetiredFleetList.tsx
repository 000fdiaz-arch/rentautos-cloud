import type { ControlUnitRow } from "../../cloudData";
import { optionalString } from "./controlUnitsRules";

function dateLabel(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-PA");
}

export function RetiredFleetList({
  rows,
  readOnly,
  onRestore,
  onHistory
}: {
  rows: ControlUnitRow[];
  readOnly: boolean;
  onRestore: (row: ControlUnitRow) => void;
  onHistory: (row: ControlUnitRow) => void;
}) {
  return (
    <div className="table-scroll fleet-table-scroll">
      <table className="ar-table">
        <thead>
          <tr>
            <th>Última nomenclatura</th>
            <th>Marca / Modelo</th>
            <th>Placa</th>
            <th>Chasis</th>
            <th>Cliente anterior</th>
            <th>Motivo</th>
            <th>Fecha de baja</th>
            <th>Observación</th>
            <th>Responsable</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={10}><span className="hint">No hay autos dados de baja.</span></td></tr>
          ) : rows.map((row) => (
            <tr key={row.fleet_id}>
              <td><strong>{row.unit_id}</strong></td>
              <td>{row.brand_model ?? "-"}</td>
              <td>{row.plate ?? "-"}</td>
              <td>{row.chassis_serial ?? "-"}</td>
              <td>{row.retired_client_name ?? "-"}</td>
              <td>{row.retired_reason ?? "-"}</td>
              <td>{dateLabel(row.retired_at)}</td>
              <td className="ar-truncate-line" title={optionalString(row, ["retired_note"])}>{row.retired_note ?? "-"}</td>
              <td>{row.retired_by_email ?? row.retired_by ?? "-"}</td>
              <td><div className="panel-actions">
                <button type="button" className="button ghost small" onClick={() => onHistory(row)}>Historial</button>
                {!readOnly && <button type="button" className="button ghost small" onClick={() => onRestore(row)}>Reactivar</button>}
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
