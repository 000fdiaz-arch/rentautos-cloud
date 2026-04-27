import { useMemo, useState, type FormEvent } from "react";
import { formatCurrency, formatFileDate } from "../format";
import type {
  BankRule,
  Client,
  LateFeeSettings,
  OtherChargesRetentionByClient,
  OtherChargesRetentionCycle
} from "../types";

type FormState = {
  accountNumber: string;
  groupCode: string;
};

type OtherChargesSortField = "unit" | "client" | "pending" | "retention" | "cycle" | "status";
type SortDirection = "asc" | "desc";

type OtherChargesFilters = {
  unit: string;
  client: string;
  pending: string;
  retention: string;
  cycle: string;
  status: string;
};

type Props = {
  bankRules: BankRule[];
  clients: Client[];
  lateFeeSettings: LateFeeSettings;
  otherChargesRetentionByClient: OtherChargesRetentionByClient;
  onBankRulesChange: (next: BankRule[]) => void;
  onLateFeeSettingsChange: (next: LateFeeSettings) => void;
  onOtherChargesRetentionByClientChange: (next: OtherChargesRetentionByClient) => void;
};

const initialForm: FormState = {
  accountNumber: "",
  groupCode: ""
};

const DEFAULT_OTHER_CHARGES_RETENTION = 5;
const RETENTION_CYCLE_OPTIONS: OtherChargesRetentionCycle[] = ["daily", "weekly", "biweekly", "monthly", "when_payment"];
const RETENTION_CYCLE_LABEL: Record<OtherChargesRetentionCycle, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  when_payment: "Cuando paga"
};
const EMPTY_OTHER_CHARGES_FILTERS: OtherChargesFilters = {
  unit: "",
  client: "",
  pending: "",
  retention: "",
  cycle: "",
  status: ""
};

function normalizeAccountNumber(value: string): string {
  return value.replace(/\D+/g, "");
}

function normalizeGroupCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeUnitId(value: string): string {
  return value.trim().toUpperCase();
}

export default function SettingsPage({
  bankRules,
  clients,
  lateFeeSettings,
  otherChargesRetentionByClient,
  onBankRulesChange,
  onLateFeeSettingsChange,
  onOtherChargesRetentionByClientChange
}: Props) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [lateFeeUnitInput, setLateFeeUnitInput] = useState<string>("");
  const [lateFeeErrors, setLateFeeErrors] = useState<string[]>([]);
  const [otherChargesDraftByClient, setOtherChargesDraftByClient] = useState<Record<string, string>>({});
  const [otherChargesRetentionErrors, setOtherChargesRetentionErrors] = useState<string[]>([]);
  const [otherChargesSortField, setOtherChargesSortField] = useState<OtherChargesSortField>("unit");
  const [otherChargesSortDirection, setOtherChargesSortDirection] = useState<SortDirection>("asc");
  const [otherChargesFilters, setOtherChargesFilters] = useState<OtherChargesFilters>(EMPTY_OTHER_CHARGES_FILTERS);

  const activeRules = useMemo(
    () => bankRules.filter((r) => r.active).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)),
    [bankRules]
  );

  const inactiveRules = useMemo(
    () => bankRules.filter((r) => !r.active).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [bankRules]
  );

  const clientsByUnit = useMemo(() => {
    const map = new Map<string, Client[]>();
    for (const client of clients) {
      const unit = normalizeUnitId(client.unitId);
      if (!unit) continue;
      const row = map.get(unit) ?? [];
      row.push(client);
      map.set(unit, row);
    }
    return map;
  }, [clients]);

  const clientsWithPendingOtherCharges = useMemo(() => {
    return clients
      .filter((client) => !client.archivedAt && client.status === "active")
      .map((client) => ({
        client,
        pendingOtherCharges: (client.otherCharges ?? [])
          .reduce((sum, charge) => sum + Math.max(0, Number(charge.amount) || 0), 0)
      }))
      .filter((row) => row.pendingOtherCharges > 0);
  }, [clients]);

  const sortedClientsWithPendingOtherCharges = useMemo(() => {
    const dir = otherChargesSortDirection === "asc" ? 1 : -1;
    return [...clientsWithPendingOtherCharges].sort((a, b) => {
      const aConfig = getRetentionConfigForClient(a.client);
      const bConfig = getRetentionConfigForClient(b.client);
      const aRetention = aConfig.amount;
      const bRetention = bConfig.amount;
      if (otherChargesSortField === "unit") return a.client.unitId.localeCompare(b.client.unitId) * dir;
      if (otherChargesSortField === "client") return a.client.name.localeCompare(b.client.name) * dir;
      if (otherChargesSortField === "pending") return (a.pendingOtherCharges - b.pendingOtherCharges) * dir;
      if (otherChargesSortField === "retention") return (aRetention - bRetention) * dir;
      if (otherChargesSortField === "cycle") {
        return RETENTION_CYCLE_LABEL[aConfig.cycle].localeCompare(RETENTION_CYCLE_LABEL[bConfig.cycle]) * dir;
      }
      const aStatus = aRetention > 0 ? 1 : 0;
      const bStatus = bRetention > 0 ? 1 : 0;
      return (aStatus - bStatus) * dir;
    });
  }, [clientsWithPendingOtherCharges, otherChargesSortDirection, otherChargesSortField]);

  const filteredAndSortedClientsWithPendingOtherCharges = useMemo(() => {
    const normalize = (value: string): string => value.trim().toLowerCase();
    const includesFilter = (target: string, query: string): boolean => {
      const normalizedQuery = normalize(query);
      if (!normalizedQuery) return true;
      return normalize(target).includes(normalizedQuery);
    };

    return sortedClientsWithPendingOtherCharges.filter(({ client, pendingOtherCharges }) => {
      const config = getRetentionConfigForClient(client);
      const retentionAmount = config.amount;
      const status = retentionAmount > 0 ? "activa" : "desactivada";
      const pendingLabel = `${pendingOtherCharges.toFixed(2)} ${formatCurrency(pendingOtherCharges)}`;
      const retentionLabel = `${retentionAmount.toFixed(2)} ${formatCurrency(retentionAmount)}`;
      return (
        includesFilter(client.unitId, otherChargesFilters.unit) &&
        includesFilter(client.name, otherChargesFilters.client) &&
        includesFilter(pendingLabel, otherChargesFilters.pending) &&
        includesFilter(retentionLabel, otherChargesFilters.retention) &&
        includesFilter(RETENTION_CYCLE_LABEL[config.cycle], otherChargesFilters.cycle) &&
        includesFilter(status, otherChargesFilters.status)
      );
    });
  }, [otherChargesFilters, sortedClientsWithPendingOtherCharges]);

  function getRetentionConfigForClient(client: Client): { amount: number; cycle: OtherChargesRetentionCycle } {
    const configured = otherChargesRetentionByClient[client.id];
    const amount = Number.isFinite(configured?.amount) ? Math.max(0, configured.amount) : DEFAULT_OTHER_CHARGES_RETENTION;
    const cycle = configured?.cycle && RETENTION_CYCLE_OPTIONS.includes(configured.cycle)
      ? configured.cycle
      : client.frequency;
    return { amount, cycle };
  }

  function commitOtherChargesRetention(clientId: string): void {
    const targetClient = clients.find((c) => c.id === clientId);
    if (!targetClient) return;
    const draft = otherChargesDraftByClient[clientId];
    const fallback = getRetentionConfigForClient(targetClient).amount;
    const parsed = draft === undefined ? fallback : Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setOtherChargesRetentionErrors([`Monto invalido para la unidad ${clients.find((c) => c.id === clientId)?.unitId ?? clientId}.`]);
      return;
    }
    const normalized = Math.round((parsed + Number.EPSILON) * 100) / 100;
    const previous = getRetentionConfigForClient(targetClient);
    const next = { ...otherChargesRetentionByClient, [clientId]: { amount: normalized, cycle: previous.cycle } };
    onOtherChargesRetentionByClientChange(next);
    setOtherChargesDraftByClient((prev) => {
      const updated = { ...prev };
      delete updated[clientId];
      return updated;
    });
    setOtherChargesRetentionErrors([]);
  }

  function handleRetentionCycleChange(client: Client, cycle: OtherChargesRetentionCycle): void {
    const previous = getRetentionConfigForClient(client);
    const next = {
      ...otherChargesRetentionByClient,
      [client.id]: {
        amount: previous.amount,
        cycle
      }
    };
    onOtherChargesRetentionByClientChange(next);
    setOtherChargesRetentionErrors([]);
  }

  function handleSortOtherCharges(field: OtherChargesSortField): void {
    if (otherChargesSortField === field) {
      setOtherChargesSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setOtherChargesSortField(field);
    setOtherChargesSortDirection("asc");
  }

  function renderOtherChargesSortIcon(field: OtherChargesSortField): string {
    if (otherChargesSortField !== field) return "<>";
    return otherChargesSortDirection === "asc" ? "^" : "v";
  }

  function resetForm(): void {
    setForm(initialForm);
    setEditingId(null);
    setErrors([]);
  }

  function validate(nextForm: FormState, currentEditingId: string | null): string[] {
    const messages: string[] = [];
    const accountNumber = normalizeAccountNumber(nextForm.accountNumber);
    const groupCode = normalizeGroupCode(nextForm.groupCode);

    if (!accountNumber) messages.push("El numero de cuenta es obligatorio.");
    if (!groupCode) messages.push("El grupo es obligatorio.");

    const duplicate = bankRules.find(
      (rule) =>
        rule.active &&
        rule.id !== currentEditingId &&
        normalizeAccountNumber(rule.accountNumber) === accountNumber
    );
    if (duplicate) {
      messages.push("Ya existe una regla activa para ese numero de cuenta.");
    }

    return messages;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const validationErrors = validate(form, editingId);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    const now = new Date().toISOString();
    const accountNumber = normalizeAccountNumber(form.accountNumber);
    const groupCode = normalizeGroupCode(form.groupCode);

    if (editingId) {
      const next = bankRules.map((rule) =>
        rule.id === editingId
          ? { ...rule, accountNumber, groupCode, updatedAt: now, active: true }
          : rule
      );
      onBankRulesChange(next);
    } else {
      const nextRule: BankRule = {
        id: crypto.randomUUID(),
        accountNumber,
        groupCode,
        active: true,
        createdAt: now,
        updatedAt: now
      };
      onBankRulesChange([nextRule, ...bankRules]);
    }

    resetForm();
  }

  function handleEdit(rule: BankRule): void {
    setForm({ accountNumber: rule.accountNumber, groupCode: rule.groupCode });
    setEditingId(rule.id);
    setErrors([]);
  }

  function handleToggleActive(ruleId: string, active: boolean): void {
    const now = new Date().toISOString();
    const next = bankRules.map((rule) =>
      rule.id === ruleId ? { ...rule, active, updatedAt: now } : rule
    );
    onBankRulesChange(next);
    if (!active && editingId === ruleId) {
      resetForm();
    }
  }

  function handleLateFeeToggle(active: boolean): void {
    onLateFeeSettingsChange({ ...lateFeeSettings, active });
  }

  function handleLateFeeAmountChange(value: string): void {
    const parsed = Number(value);
    onLateFeeSettingsChange({
      ...lateFeeSettings,
      dailyAmount: Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    });
  }

  function handleLateFeeLabelChange(value: string): void {
    onLateFeeSettingsChange({
      ...lateFeeSettings,
      chargeLabel: value
    });
  }

  function handleAddLateFeeUnit(): void {
    const normalized = normalizeUnitId(lateFeeUnitInput);
    const messages: string[] = [];
    if (!normalized) messages.push("Debes indicar un numero de unidad.");
    if (lateFeeSettings.selectedUnits.includes(normalized)) {
      messages.push(`La unidad ${normalized} ya estaba en la lista.`);
    }
    if (messages.length > 0) {
      setLateFeeErrors(messages);
      return;
    }
    onLateFeeSettingsChange({
      ...lateFeeSettings,
      selectedUnits: [...lateFeeSettings.selectedUnits, normalized].sort((a, b) => a.localeCompare(b))
    });
    setLateFeeUnitInput("");
    setLateFeeErrors([]);
  }

  function handleRemoveLateFeeUnit(unitId: string): void {
    onLateFeeSettingsChange({
      ...lateFeeSettings,
      selectedUnits: lateFeeSettings.selectedUnits.filter((unit) => unit !== unitId)
    });
  }

  function buildOtherChargesExportRows(): (string | number)[][] {
    return filteredAndSortedClientsWithPendingOtherCharges.map(({ client, pendingOtherCharges }) => {
      const config = getRetentionConfigForClient(client);
      const retentionAmount = config.amount;
      const status = retentionAmount > 0 ? "Activa" : "Desactivada";
      return [client.unitId, client.name, pendingOtherCharges, retentionAmount, RETENTION_CYCLE_LABEL[config.cycle], status];
    });
  }

  async function handleExportOtherChargesExcel(): Promise<void> {
    if (filteredAndSortedClientsWithPendingOtherCharges.length === 0) return;
    try {
      const now = new Date();
      const headers = ["Unidad", "Cliente", "Total otros cargos", "Retencion automatica", "Ciclo de cobro", "Estado"];
      const body = buildOtherChargesExportRows();
      const xlsx = await import("xlsx");
      const worksheet = xlsx.utils.aoa_to_sheet([headers, ...body]);
      const colWidths = headers.map((header, index) => ({
        wch: Math.max(header.length, ...body.map((row) => String(row[index]).length)) + 2
      }));
      worksheet["!cols"] = colWidths;
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, "Otros Cargos");
      xlsx.writeFile(workbook, `rentautos-otros-cargos-${formatFileDate(now)}.xlsx`);
      setOtherChargesRetentionErrors([]);
    } catch {
      setOtherChargesRetentionErrors(["No se pudo exportar la lista de otros cargos a Excel."]);
    }
  }

  async function handleExportOtherChargesPdf(): Promise<void> {
    if (filteredAndSortedClientsWithPendingOtherCharges.length === 0) return;
    try {
      const now = new Date();
      const headers = ["Unidad", "Cliente", "Total otros cargos", "Retencion automatica", "Ciclo de cobro", "Estado"];
      const body = buildOtherChargesExportRows();
      const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable")
      ]);
      const document = new JsPDF({ orientation: "landscape" });
      document.setFontSize(14);
      document.text("Rentautos - Otros Cargos", 14, 16);
      document.setFontSize(9);
      document.text(`Generado: ${now.toLocaleDateString("es-PA")}`, 14, 22);
      autoTable(document, {
        head: [headers],
        body: body.map((row) => row.map((cell) => String(cell))),
        startY: 28,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] }
      });
      document.save(`rentautos-otros-cargos-${formatFileDate(now)}.pdf`);
      setOtherChargesRetentionErrors([]);
    } catch {
      setOtherChargesRetentionErrors(["No se pudo exportar la lista de otros cargos a PDF."]);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Recargos por mora</h2>
        </div>

        <div className="form-grid">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={lateFeeSettings.active}
              onChange={(e) => handleLateFeeToggle(e.target.checked)}
            />
            Activar recargo automatico en cierre
          </label>

          <label>
            Monto diario (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              value={lateFeeSettings.dailyAmount}
              onChange={(e) => handleLateFeeAmountChange(e.target.value)}
            />
          </label>

          <label>
            Etiqueta del cargo
            <input
              type="text"
              value={lateFeeSettings.chargeLabel}
              onChange={(e) => handleLateFeeLabelChange(e.target.value)}
            />
          </label>
        </div>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>
            Numero de unidad
            <input
              type="text"
              placeholder="Ej. T03"
              value={lateFeeUnitInput}
              onChange={(e) => setLateFeeUnitInput(normalizeUnitId(e.target.value))}
            />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="button" className="button primary" onClick={handleAddLateFeeUnit}>
              Agregar unidad
            </button>
          </div>
        </div>

        {lateFeeErrors.length > 0 && (
          <ul className="error-list">
            {lateFeeErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Unidad</th>
                <th>Cliente(s) relacionado(s)</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lateFeeSettings.selectedUnits.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty" style={{ textAlign: "center" }}>
                    No hay unidades configuradas para recargo automatico.
                  </td>
                </tr>
              ) : (
                lateFeeSettings.selectedUnits.map((unitId) => {
                  const matchedClients = clientsByUnit.get(unitId) ?? [];
                  const clientsLabel = matchedClients.length > 0
                    ? matchedClients.map((client) => client.name).join(", ")
                    : "Sin cliente activo asociado";
                  return (
                    <tr key={unitId}>
                      <td><strong>{unitId}</strong></td>
                      <td>{clientsLabel}</td>
                      <td className="actions-cell">
                        <button type="button" className="button danger small" onClick={() => handleRemoveLateFeeUnit(unitId)}>
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Otros cargos</h2>
        </div>

        <p className="hint" style={{ marginTop: 0 }}>
          Aqui defines cuanto se retiene automaticamente por unidad al registrar pagos con otros cargos pendientes.
          Si no existe configuracion previa, se usa {formatCurrency(DEFAULT_OTHER_CHARGES_RETENTION)} por defecto.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="button ghost"
            onClick={() => setOtherChargesFilters({ ...EMPTY_OTHER_CHARGES_FILTERS })}
            disabled={!Object.values(otherChargesFilters).some((value) => value.trim().length > 0)}
          >
            Limpiar filtros
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => void handleExportOtherChargesExcel()}
            disabled={filteredAndSortedClientsWithPendingOtherCharges.length === 0}
          >
            Exportar Excel
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => void handleExportOtherChargesPdf()}
            disabled={filteredAndSortedClientsWithPendingOtherCharges.length === 0}
          >
            Exportar PDF
          </button>
        </div>

        {otherChargesRetentionErrors.length > 0 && (
          <ul className="error-list">
            {otherChargesRetentionErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th><button type="button" className="sort-button" onClick={() => handleSortOtherCharges("unit")}>Unidad <span className={`sort-icon ${otherChargesSortField === "unit" ? "active" : ""}`}>{renderOtherChargesSortIcon("unit")}</span></button></th>
                <th><button type="button" className="sort-button" onClick={() => handleSortOtherCharges("client")}>Cliente <span className={`sort-icon ${otherChargesSortField === "client" ? "active" : ""}`}>{renderOtherChargesSortIcon("client")}</span></button></th>
                <th><button type="button" className="sort-button" onClick={() => handleSortOtherCharges("pending")}>Total otros cargos <span className={`sort-icon ${otherChargesSortField === "pending" ? "active" : ""}`}>{renderOtherChargesSortIcon("pending")}</span></button></th>
                <th><button type="button" className="sort-button" onClick={() => handleSortOtherCharges("retention")}>Retencion automatica (USD) <span className={`sort-icon ${otherChargesSortField === "retention" ? "active" : ""}`}>{renderOtherChargesSortIcon("retention")}</span></button></th>
                <th><button type="button" className="sort-button" onClick={() => handleSortOtherCharges("cycle")}>Ciclo de cobro <span className={`sort-icon ${otherChargesSortField === "cycle" ? "active" : ""}`}>{renderOtherChargesSortIcon("cycle")}</span></button></th>
                <th><button type="button" className="sort-button" onClick={() => handleSortOtherCharges("status")}>Estado <span className={`sort-icon ${otherChargesSortField === "status" ? "active" : ""}`}>{renderOtherChargesSortIcon("status")}</span></button></th>
              </tr>
              <tr>
                <th><input type="text" className="payment-input" placeholder="Filtrar" value={otherChargesFilters.unit} onChange={(e) => setOtherChargesFilters((prev) => ({ ...prev, unit: e.target.value }))} /></th>
                <th><input type="text" className="payment-input" placeholder="Filtrar" value={otherChargesFilters.client} onChange={(e) => setOtherChargesFilters((prev) => ({ ...prev, client: e.target.value }))} /></th>
                <th><input type="text" className="payment-input" placeholder="Filtrar" value={otherChargesFilters.pending} onChange={(e) => setOtherChargesFilters((prev) => ({ ...prev, pending: e.target.value }))} /></th>
                <th><input type="text" className="payment-input" placeholder="Filtrar" value={otherChargesFilters.retention} onChange={(e) => setOtherChargesFilters((prev) => ({ ...prev, retention: e.target.value }))} /></th>
                <th><input type="text" className="payment-input" placeholder="Filtrar" value={otherChargesFilters.cycle} onChange={(e) => setOtherChargesFilters((prev) => ({ ...prev, cycle: e.target.value }))} /></th>
                <th><input type="text" className="payment-input" placeholder="Filtrar" value={otherChargesFilters.status} onChange={(e) => setOtherChargesFilters((prev) => ({ ...prev, status: e.target.value }))} /></th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedClientsWithPendingOtherCharges.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty" style={{ textAlign: "center" }}>
                    No hay resultados con los filtros actuales.
                  </td>
                </tr>
              ) : (
                filteredAndSortedClientsWithPendingOtherCharges.map(({ client, pendingOtherCharges }) => {
                  const configured = getRetentionConfigForClient(client);
                  const configuredValue = configured.amount;
                  const draftValue = otherChargesDraftByClient[client.id];
                  const inputValue = draftValue ?? String(configuredValue);
                  return (
                    <tr key={client.id}>
                      <td><strong>{client.unitId}</strong></td>
                      <td>{client.name}</td>
                      <td><span className="amount-warning">{formatCurrency(pendingOtherCharges)}</span></td>
                      <td style={{ minWidth: 180 }}>
                        <input
                          type="number"
                          className="payment-input"
                          min="0"
                          step="0.01"
                          value={inputValue}
                          onChange={(e) => setOtherChargesDraftByClient((prev) => ({ ...prev, [client.id]: e.target.value }))}
                          onBlur={() => commitOtherChargesRetention(client.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitOtherChargesRetention(client.id);
                            }
                          }}
                        />
                      </td>
                      <td style={{ minWidth: 170 }}>
                        <select
                          className="payment-input"
                          value={configured.cycle}
                          onChange={(e) => handleRetentionCycleChange(client, e.target.value as OtherChargesRetentionCycle)}
                        >
                          {RETENTION_CYCLE_OPTIONS.map((cycle) => (
                            <option key={cycle} value={cycle}>{RETENTION_CYCLE_LABEL[cycle]}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {configuredValue > 0 ? <span className="badge-sim">Activa</span> : <span className="amount-muted">Desactivada (0)</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Regla bancaria</h2>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Numero de cuenta
            <input
              type="text"
              inputMode="numeric"
              placeholder="Ej. 3380008048"
              value={form.accountNumber}
              onChange={(e) => setForm((prev) => ({ ...prev, accountNumber: normalizeAccountNumber(e.target.value) }))}
            />
          </label>

          <label>
            Grupo
            <input
              type="text"
              placeholder="Ej. T"
              maxLength={8}
              value={form.groupCode}
              onChange={(e) => setForm((prev) => ({ ...prev, groupCode: normalizeGroupCode(e.target.value) }))}
            />
          </label>

          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button type="submit" className="button primary">
              {editingId ? "Guardar cambios" : "Agregar regla"}
            </button>
            {editingId && (
              <button type="button" className="button ghost" onClick={resetForm}>
                Cancelar
              </button>
            )}
          </div>
        </form>

        {errors.length > 0 && (
          <ul className="error-list">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Numero de cuenta</th>
                <th>Grupo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {activeRules.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                    No hay reglas bancarias activas.
                  </td>
                </tr>
              ) : (
                activeRules.map((rule) => (
                  <tr key={rule.id}>
                    <td><code>{rule.accountNumber}</code></td>
                    <td><strong>Grupo {rule.groupCode}</strong></td>
                    <td><span className="badge-sim">Activa</span></td>
                    <td className="actions-cell">
                      <button type="button" className="button ghost small" onClick={() => handleEdit(rule)}>
                        Editar
                      </button>
                      <button type="button" className="button danger small" onClick={() => handleToggleActive(rule.id, false)}>
                        Desactivar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {inactiveRules.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Reglas desactivadas</h2>
          </div>
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Numero de cuenta</th>
                  <th>Grupo</th>
                  <th>Actualizado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {inactiveRules.map((rule) => (
                  <tr key={rule.id}>
                    <td><code>{rule.accountNumber}</code></td>
                    <td>Grupo {rule.groupCode}</td>
                    <td>{new Date(rule.updatedAt).toLocaleString("es-PA")}</td>
                    <td className="actions-cell">
                      <button type="button" className="button ghost small" onClick={() => handleToggleActive(rule.id, true)}>
                        Reactivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

