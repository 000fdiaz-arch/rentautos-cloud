import { useMemo, useState } from "react";
import { formatCurrency, formatFileDate } from "../../format";
import type { Client, OtherChargesRetentionByClient, OtherChargesRetentionCycle } from "../../types";

const DEFAULT_RETENTION = 5;
const CYCLES: OtherChargesRetentionCycle[] = ["daily", "weekly", "biweekly", "monthly", "when_payment"];
const CYCLE_LABEL: Record<OtherChargesRetentionCycle, string> = { daily: "Diario", weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual", when_payment: "Cuando paga" };
type SortField = "unit" | "client" | "pending" | "retention" | "cycle" | "status";
type Filters = Record<SortField, string>;
const EMPTY_FILTERS: Filters = { unit: "", client: "", pending: "", retention: "", cycle: "", status: "" };

type Props = {
  clients: Client[];
  settings: OtherChargesRetentionByClient;
  onChange: (next: OtherChargesRetentionByClient) => void;
};

export default function OtherChargesSettingsPanel({ clients, settings, onChange }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [sortField, setSortField] = useState<SortField>("unit");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  function configFor(client: Client) {
    const configured = settings[client.id];
    const amount = Number.isFinite(configured?.amount) ? Math.max(0, configured.amount) : DEFAULT_RETENTION;
    const cycle = configured?.cycle && CYCLES.includes(configured.cycle) ? configured.cycle : client.frequency;
    return { amount, cycle };
  }

  const rows = useMemo(() => {
    const includes = (value: string, filter: string) => value.toLowerCase().includes(filter.trim().toLowerCase());
    const direction = sortDirection === "asc" ? 1 : -1;
    return clients
      .filter((client) => !client.archivedAt && client.status !== "archivado")
      .map((client) => ({ client, pending: (client.otherCharges ?? []).reduce((sum, charge) => sum + Math.max(0, charge.amount), 0) }))
      .filter((row) => row.pending > 0)
      .filter(({ client, pending }) => {
        const config = configFor(client);
        return includes(client.unitId, filters.unit) && includes(client.name, filters.client) && includes(formatCurrency(pending), filters.pending) && includes(formatCurrency(config.amount), filters.retention) && includes(CYCLE_LABEL[config.cycle], filters.cycle) && includes(config.amount > 0 ? "Activa" : "Desactivada", filters.status);
      })
      .sort((left, right) => {
        const a = configFor(left.client);
        const b = configFor(right.client);
        const comparison = sortField === "unit" ? left.client.unitId.localeCompare(right.client.unitId)
          : sortField === "client" ? left.client.name.localeCompare(right.client.name)
          : sortField === "pending" ? left.pending - right.pending
          : sortField === "retention" ? a.amount - b.amount
          : sortField === "cycle" ? CYCLE_LABEL[a.cycle].localeCompare(CYCLE_LABEL[b.cycle])
          : Number(a.amount > 0) - Number(b.amount > 0);
        return comparison * direction;
      });
  }, [clients, filters, settings, sortDirection, sortField]);

  function commit(clientId: string): void {
    const raw = drafts[clientId];
    if (raw === undefined) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      setErrors(["La retencion debe ser un numero mayor o igual a 0."]);
      return;
    }
    const previous = settings[clientId] ?? { amount: DEFAULT_RETENTION, cycle: "daily" as const };
    onChange({ ...settings, [clientId]: { ...previous, amount } });
    setDrafts((current) => { const next = { ...current }; delete next[clientId]; return next; });
    setErrors([]);
  }

  function sort(field: SortField): void {
    if (sortField === field) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDirection("asc"); }
  }

  function exportRows(): (string | number)[][] {
    return rows.map(({ client, pending }) => {
      const config = configFor(client);
      return [client.unitId, client.name, pending, config.amount, CYCLE_LABEL[config.cycle], config.amount > 0 ? "Activa" : "Desactivada"];
    });
  }

  async function exportExcel(): Promise<void> {
    try {
      const headers = ["Unidad", "Cliente", "Total otros cargos", "Retencion automatica", "Ciclo de cobro", "Estado"];
      const xlsx = await import("xlsx");
      const worksheet = xlsx.utils.aoa_to_sheet([headers, ...exportRows()]);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, "Otros Cargos");
      xlsx.writeFile(workbook, `rentautos-otros-cargos-${formatFileDate(new Date())}.xlsx`);
      setErrors([]);
    } catch { setErrors(["No se pudo exportar la lista de otros cargos a Excel."]); }
  }

  async function exportPdf(): Promise<void> {
    try {
      const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const document = new JsPDF({ orientation: "landscape" });
      document.text("Rentautos - Otros Cargos", 14, 16);
      autoTable(document, { head: [["Unidad", "Cliente", "Total otros cargos", "Retencion automatica", "Ciclo de cobro", "Estado"]], body: exportRows().map((row) => row.map(String)), startY: 24 });
      document.save(`rentautos-otros-cargos-${formatFileDate(new Date())}.pdf`);
      setErrors([]);
    } catch { setErrors(["No se pudo exportar la lista de otros cargos a PDF."]); }
  }

  const sortIcon = (field: SortField) => sortField === field ? (sortDirection === "asc" ? "^" : "v") : "<>";
  return (
    <section className="panel">
      <div className="panel-head"><h2>Otros cargos</h2></div>
      <p className="hint" style={{ marginTop: 0 }}>Aqui defines cuanto se retiene automaticamente por unidad al registrar pagos con otros cargos pendientes. Si no existe configuracion previa, se usa {formatCurrency(DEFAULT_RETENTION)} por defecto.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="button ghost" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!Object.values(filters).some((value) => value.trim())}>Limpiar filtros</button>
        <button type="button" className="button ghost" onClick={() => void exportExcel()} disabled={rows.length === 0}>Exportar Excel</button>
        <button type="button" className="button ghost" onClick={() => void exportPdf()} disabled={rows.length === 0}>Exportar PDF</button>
      </div>
      {errors.length > 0 && <ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      <div className="table-scroll" style={{ marginTop: 12 }}><table><thead>
        <tr>{(["unit", "client", "pending", "retention", "cycle", "status"] as SortField[]).map((field, index) => <th key={field}><button type="button" className="sort-button" onClick={() => sort(field)}>{["Unidad", "Cliente", "Total otros cargos", "Retencion automatica (USD)", "Ciclo de cobro", "Estado"][index]} <span className={`sort-icon ${sortField === field ? "active" : ""}`}>{sortIcon(field)}</span></button></th>)}</tr>
        <tr>{(["unit", "client", "pending", "retention", "cycle", "status"] as SortField[]).map((field) => <th key={field}><input type="text" className="payment-input" placeholder="Filtrar" value={filters[field]} onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))} /></th>)}</tr>
      </thead><tbody>{rows.length === 0 ? <tr><td colSpan={6} className="empty" style={{ textAlign: "center" }}>No hay resultados con los filtros actuales.</td></tr> : rows.map(({ client, pending }) => {
        const config = configFor(client);
        return <tr key={client.id}><td><strong>{client.unitId}</strong></td><td>{client.name}</td><td><span className="amount-warning">{formatCurrency(pending)}</span></td><td><input type="number" className="payment-input" min="0" step="0.01" value={drafts[client.id] ?? String(config.amount)} onChange={(event) => setDrafts((current) => ({ ...current, [client.id]: event.target.value }))} onBlur={() => commit(client.id)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(client.id); } }} /></td><td><select className="payment-input" value={config.cycle} onChange={(event) => onChange({ ...settings, [client.id]: { ...config, cycle: event.target.value as OtherChargesRetentionCycle } })}>{CYCLES.map((cycle) => <option key={cycle} value={cycle}>{CYCLE_LABEL[cycle]}</option>)}</select></td><td>{config.amount > 0 ? <span className="badge-sim">Activa</span> : <span className="amount-muted">Desactivada (0)</span>}</td></tr>;
      })}</tbody></table></div>
    </section>
  );
}
