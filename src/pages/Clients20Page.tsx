import { useEffect, useMemo, useState } from "react";
import { loadControlUnits } from "../cloudData";
import type { Client } from "../types";

type Props = {
  clients: Client[];
  dataOwnerUserId?: string | null;
};

export default function Clients20Page({ clients, dataOwnerUserId }: Props) {
  const [fleetUnits, setFleetUnits] = useState<Set<string>>(new Set());
  const [loadingFleet, setLoadingFleet] = useState<boolean>(false);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setFleetUnits(new Set());
      return;
    }
    let cancelled = false;
    setLoadingFleet(true);
    void (async () => {
      try {
        const data = await loadControlUnits(dataOwnerUserId);
        if (cancelled) return;
        const units = new Set(
          data
            .map((row) => String(row.unit_id ?? "").trim().toUpperCase())
            .filter((unit) => unit.length > 0)
        );
        setFleetUnits(units);
      } catch (error) {
        console.error("No se pudo cargar flota para Clientes archivados.", error);
      } finally {
        if (!cancelled) setLoadingFleet(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

  const rows = useMemo(() => {
    return clients
      .filter((client) => {
        const unit = String(client.unitId ?? "").trim().toUpperCase();
        if (!unit) return true;
        return !fleetUnits.has(unit);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, fleetUnits]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Clientes archivados</h2>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Clientes sin unidad asignada o con unidad no registrada en flota. Estado aplicado: Inactivo.
      </p>
      {loadingFleet && <p className="hint">Cargando flota...</p>}
      <p className="hint">Mostrando {rows.length} clientes.</p>

      <div className="table-scroll" style={{ borderTop: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Cedula</th>
              <th>Unidad/ID</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">No hay clientes archivados.</td>
              </tr>
            ) : (
              rows.map((client: Client) => (
                <tr key={client.id}>
                  <td><strong>{client.name}</strong></td>
                  <td>{client.cedula ?? "-"}</td>
                  <td>{client.unitId?.trim() ? client.unitId : "-"}</td>
                  <td><span className="badge badge-warning">Inactivo</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
