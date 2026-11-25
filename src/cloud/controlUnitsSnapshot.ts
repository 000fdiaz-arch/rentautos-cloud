import { getCloudClient } from "./cloudClient";
import type { ControlUnitRow } from "./operationsCloudData";

export async function loadControlUnitsSnapshot(owner: string): Promise<ControlUnitRow[] | null> {
  const { data, error } = await getCloudClient().rpc("read_control_units_snapshot", { p_user_id: owner });
  if (error) {
    // Existing installations retain their complete paginated readers.
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw error;
  }
  if (!data || data.version !== 1 || data.owner !== owner.toLowerCase() || !Array.isArray(data.rows) ||
    !data.rows.every((row: unknown) => row && typeof row === "object" && !Array.isArray(row) &&
      typeof (row as ControlUnitRow).fleet_id === "string" && (row as ControlUnitRow).user_id === owner.toLowerCase())) {
    throw new Error("La respuesta de autos cloud esta incompleta.");
  }
  if (new Set(data.rows.map((row: ControlUnitRow) => row.fleet_id)).size !== data.rows.length) {
    throw new Error("La respuesta de autos cloud contiene registros duplicados.");
  }
  return data.rows as ControlUnitRow[];
}
