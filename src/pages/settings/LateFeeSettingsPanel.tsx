import { useMemo, useState } from "react";
import type { Client, LateFeeSettings } from "../../types";

type Props = {
  clients: Client[];
  settings: LateFeeSettings;
  onChange: (next: LateFeeSettings) => void;
};

export default function LateFeeSettingsPanel({ clients, settings, onChange }: Props) {
  const [unitInput, setUnitInput] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const clientsByUnit = useMemo(() => {
    const map = new Map<string, Client[]>();
    clients.forEach((client) => {
      const unit = client.unitId.trim().toUpperCase();
      if (unit) map.set(unit, [...(map.get(unit) ?? []), client]);
    });
    return map;
  }, [clients]);

  function addUnit(): void {
    const unit = unitInput.trim().toUpperCase();
    const nextErrors: string[] = [];
    if (!unit) nextErrors.push("Debes indicar una unidad.");
    if (settings.selectedUnits.includes(unit)) nextErrors.push("La unidad ya esta configurada.");
    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }
    onChange({ ...settings, selectedUnits: [...settings.selectedUnits, unit].sort((a, b) => a.localeCompare(b)) });
    setUnitInput("");
    setErrors([]);
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Recargos por mora</h2></div>
      <div className="form-grid">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={settings.active} onChange={(event) => onChange({ ...settings, active: event.target.checked })} />Activar recargo automatico en cierre</label>
        <label>Monto diario (USD)<input type="number" min="0" step="0.01" value={settings.dailyAmount} onChange={(event) => onChange({ ...settings, dailyAmount: Math.max(0, Number(event.target.value) || 0) })} /></label>
        <label>Etiqueta del cargo<input type="text" value={settings.chargeLabel} onChange={(event) => onChange({ ...settings, chargeLabel: event.target.value })} /></label>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label>Numero de unidad<input type="text" placeholder="Ej. T03" value={unitInput} onChange={(event) => setUnitInput(event.target.value.trim().toUpperCase())} /></label>
        <div style={{ display: "flex", alignItems: "end" }}><button type="button" className="button primary" onClick={addUnit}>Agregar unidad</button></div>
      </div>
      {errors.length > 0 && <ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table><thead><tr><th>Unidad</th><th>Cliente(s) relacionado(s)</th><th>Acciones</th></tr></thead>
          <tbody>{settings.selectedUnits.length === 0 ? <tr><td colSpan={3} className="empty" style={{ textAlign: "center" }}>No hay unidades configuradas para recargo automatico.</td></tr> : settings.selectedUnits.map((unit) => {
            const matched = clientsByUnit.get(unit) ?? [];
            return <tr key={unit}><td><strong>{unit}</strong></td><td>{matched.length > 0 ? matched.map((client) => client.name).join(", ") : "Sin cliente activo asociado"}</td><td className="actions-cell"><button type="button" className="button danger small" onClick={() => onChange({ ...settings, selectedUnits: settings.selectedUnits.filter((item) => item !== unit) })}>Quitar</button></td></tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
