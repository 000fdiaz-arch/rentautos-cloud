import { Fragment, useEffect, useMemo, useState } from "react";
import { toDateKey } from "../billing";
import { loadControlUnits, type ControlUnitRow } from "../cloudData";
import { formatCurrency } from "../format";
import type { Client } from "../types";

type Props = {
  dataOwnerUserId?: string | null;
  clients: Client[];
  onClientsChange: (next: Client[]) => Promise<void>;
};

type FinancialFilter = "all" | "moroso" | "al_dia" | "sin_cliente";
type SortDirection = "asc" | "desc";
type SortField = "unit" | "operational" | "cobranza" | "info";
type InfoSection = "unidad" | "cliente" | "cobranza";
type BillingDraft = {
  rentAmount: number;
  frequency: Client["frequency"];
  installmentsAgreed: number;
  installmentsRemaining: number;
  installmentsPaid: number;
};

type OperationalFilter =
  | "all"
  | "activo"
  | "cliente_enfermo"
  | "taller"
  | "chapisteria"
  | "custodia"
  | "en_busqueda"
  | "archivado"
  | "sin_estado";

const OPERATIONAL_OPTIONS: Client["status"][] = [
  "activo",
  "cliente_enfermo",
  "taller",
  "chapisteria",
  "custodia",
  "en_busqueda",
  "archivado"
];

function groupFromUnit(unitId: string): string {
  const cleaned = unitId.trim().toUpperCase();
  return cleaned.length > 0 ? cleaned[0] : "";
}

function formatMoney(value: number): string {
  return formatCurrency(value);
}

function normalizeBalance(value: ControlUnitRow["financial_balance"]): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function financialLabel(value: string): string {
  if (value === "moroso") return "Moroso";
  if (value === "al_dia") return "Al dia";
  if (value === "sin_cliente") return "Sin cliente";
  return value || "Sin estado";
}

function operationalLabel(value: string | null): string {
  if (!value) return "Sin estado";
  if (value === "activo") return "Activo";
  if (value === "cliente_enfermo") return "Cliente enfermo";
  if (value === "taller") return "Taller";
  if (value === "chapisteria") return "Chapisteria";
  if (value === "custodia") return "Custodia";
  if (value === "en_busqueda") return "En busqueda";
  if (value === "archivado") return "Archivado";
  return value;
}

function frequencyLabel(value: Client["frequency"] | undefined): string {
  if (!value) return "-";
  if (value === "daily") return "Diaria";
  if (value === "weekly") return "Semanal";
  if (value === "biweekly") return "Quincenal";
  if (value === "monthly") return "Mensual";
  return value;
}

function parseDateOnly(value?: string): Date | null {
  if (!value) return null;
  const only = value.slice(0, 10);
  const dt = new Date(`${only}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function daysSince(value?: string): number | null {
  const dt = parseDateOnly(value);
  if (!dt) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today.getTime() - dt.getTime()) / 86400000));
}

function debtSinceTone(days: number | null): string {
  if (days === null) return "amount-muted";
  if (days <= 0) return "amount-good";
  if (days <= 7) return "amount-warning";
  return "amount-debt";
}

function operationalToneClass(value: string | null): string {
  if (value === "activo") return "control-op-badge control-op-badge--activo";
  if (value === "cliente_enfermo") return "control-op-badge control-op-badge--enfermo";
  if (value === "taller") return "control-op-badge control-op-badge--taller";
  if (value === "chapisteria") return "control-op-badge control-op-badge--chapisteria";
  if (value === "custodia") return "control-op-badge control-op-badge--custodia";
  if (value === "en_busqueda") return "control-op-badge control-op-badge--busqueda";
  if (value === "archivado") return "control-op-badge control-op-badge--archivado";
  return "control-op-badge control-op-badge--sin-estado";
}

function isStatusAllowedForClient(client: Client, nextStatus: Client["status"]): boolean {
  if (nextStatus !== "cliente_enfermo") return true;
  return client.frequency === "daily";
}

function requiresComment(nextStatus: Client["status"]): boolean {
  return nextStatus === "taller" || nextStatus === "chapisteria" || nextStatus === "custodia" || nextStatus === "archivado";
}

function applyClientStatusChange(client: Client, nextStatus: Client["status"], comment: string): Client {
  const normalizedComment = comment.trim() || undefined;
  if (nextStatus === "activo") {
    return {
      ...client,
      status: "activo",
      statusComment: undefined,
      archivedAt: undefined,
      lastChargeDate: toDateKey(new Date())
    };
  }
  if (nextStatus === "archivado") {
    return {
      ...client,
      status: "archivado",
      statusComment: normalizedComment,
      archivedAt: new Date().toISOString()
    };
  }
  return {
    ...client,
    status: nextStatus,
    statusComment: normalizedComment
  };
}

export default function ControlUnitsPage({ dataOwnerUserId, clients, onClientsChange }: Props) {
  const [rows, setRows] = useState<ControlUnitRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [operationalFilter, setOperationalFilter] = useState<OperationalFilter>("all");
  const [financialFilter, setFinancialFilter] = useState<FinancialFilter>("all");
  const [onlyFree, setOnlyFree] = useState<boolean>(false);
  const [expandedInfoKey, setExpandedInfoKey] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("unit");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [statusDialog, setStatusDialog] = useState<{ clientId: string; nextStatus: Client["status"]; comment: string } | null>(null);
  const [statusError, setStatusError] = useState<string>("");
  const [statusSaving, setStatusSaving] = useState<boolean>(false);
  const [assignDialog, setAssignDialog] = useState<{ unitId: string; name: string; cedula: string }>({
    unitId: "",
    name: "",
    cedula: ""
  });
  const [assignError, setAssignError] = useState<string>("");
  const [assignSaving, setAssignSaving] = useState<boolean>(false);
  const [billingSavingByClientId, setBillingSavingByClientId] = useState<Record<string, boolean>>({});
  const [billingErrorByClientId, setBillingErrorByClientId] = useState<Record<string, string>>({});
  const [billingDraftByClientId, setBillingDraftByClientId] = useState<Record<string, BillingDraft>>({});
  const [infoSectionByRowKey, setInfoSectionByRowKey] = useState<Record<string, InfoSection>>({});

  function toggleSort(field: SortField): void {
    if (sortField === field) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  }

  function sortIcon(field: SortField): string {
    if (sortField !== field) return "<>";
    return sortDirection === "asc" ? "^" : "v";
  }

  useEffect(() => {
    if (!dataOwnerUserId) {
      setRows([]);
      setLoading(false);
      setLoadError("No se encontro owner de datos para cargar Control de Unidades.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError("");

    void (async () => {
      try {
        const data = await loadControlUnits(dataOwnerUserId);
        if (cancelled) return;
        setRows(data);
      } catch (error) {
        if (cancelled) return;
        console.error("No se pudo cargar Control de Unidades.", error);
        setLoadError("No se pudo cargar la vista consolidada de unidades.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const group = groupFromUnit(row.unit_id ?? "");
      if (group) set.add(group);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      const unit = String(row.unit_id ?? "").trim().toUpperCase();
      const group = groupFromUnit(unit);
      const clientName = String(row.client_name ?? "").trim();
      const plate = String(row.plate ?? "").trim().toUpperCase();
      const operational = row.operational_status ?? "";
      const financial = String(row.financial_status ?? "");
      const isFree = !row.client_id;

      if (groupFilter !== "all" && group !== groupFilter) return false;
      if (operationalFilter !== "all") {
        if (operationalFilter === "sin_estado") {
          if (operational.length > 0) return false;
        } else if (operational !== operationalFilter) {
          return false;
        }
      }
      if (financialFilter !== "all" && financial !== financialFilter) return false;
      if (onlyFree && !isFree) return false;

      if (!query) return true;
      return `${unit} ${plate} ${clientName}`.toLowerCase().includes(query);
    });

    return [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortField === "unit") {
        comparison = String(a.unit_id ?? "").localeCompare(String(b.unit_id ?? ""), undefined, { numeric: true });
      } else if (sortField === "operational") {
        comparison = operationalLabel(a.operational_status).localeCompare(operationalLabel(b.operational_status));
      } else if (sortField === "cobranza") {
        comparison = financialLabel(String(a.financial_status ?? "")).localeCompare(
          financialLabel(String(b.financial_status ?? ""))
        );
        if (comparison === 0) comparison = normalizeBalance(a.financial_balance) - normalizeBalance(b.financial_balance);
      } else if (sortField === "info") {
        const aInfo = `${a.plate ?? ""} ${a.brand_model ?? ""}`.trim();
        const bInfo = `${b.plate ?? ""} ${b.brand_model ?? ""}`.trim();
        comparison = aInfo.localeCompare(bInfo);
      }
      if (comparison === 0) {
        comparison = String(a.unit_id ?? "").localeCompare(String(b.unit_id ?? ""), undefined, { numeric: true });
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [rows, search, groupFilter, operationalFilter, financialFilter, onlyFree, sortField, sortDirection]);

  async function handleApplyStatus(clientId: string, nextStatus: Client["status"], comment = ""): Promise<void> {
    const client = clients.find((item) => item.id === clientId);
    if (!client) {
      setStatusError("No se encontro cliente para actualizar estado.");
      return;
    }
    if (!isStatusAllowedForClient(client, nextStatus)) {
      setStatusError("'Cliente enfermo' solo aplica para clientes con frecuencia diaria.");
      return;
    }

    const nextClients = clients.map((item) => (
      item.id === clientId ? applyClientStatusChange(item, nextStatus, comment) : item
    ));

    setStatusSaving(true);
    setStatusError("");
    try {
      await onClientsChange(nextClients);
      setRows((current) => current.map((row) => (
        row.client_id === clientId ? { ...row, operational_status: nextStatus } : row
      )));
      setStatusDialog(null);
    } catch (error) {
      console.error("No se pudo actualizar estado operativo desde Control de Unidades.", error);
      setStatusError("No se pudo guardar el estado. Intenta nuevamente.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleStatusSelection(clientId: string, nextStatusRaw: string): Promise<void> {
    const nextStatus = nextStatusRaw as Client["status"];
    const client = clients.find((item) => item.id === clientId);
    if (!client) {
      setStatusError("No se encontro cliente para actualizar estado.");
      return;
    }
    if (client.status === nextStatus) return;

    if (requiresComment(nextStatus)) {
      setStatusDialog({ clientId, nextStatus, comment: "" });
      setStatusError("");
      return;
    }

    await handleApplyStatus(clientId, nextStatus, "");
  }

  async function handleAssignClientToUnit(): Promise<void> {
    const unitId = assignDialog.unitId.trim();
    const name = assignDialog.name.trim();
    const cedula = assignDialog.cedula.trim();

    if (!unitId || !name) {
      setAssignError("El nombre del cliente es obligatorio.");
      return;
    }

    const duplicatedCedula = cedula.length > 0 && clients.some((client) => (client.cedula ?? "").trim().toLowerCase() === cedula.toLowerCase());
    if (duplicatedCedula) {
      setAssignError("Ya existe un cliente con esa cedula.");
      return;
    }

    setAssignSaving(true);
    setAssignError("");
    try {
      const today = toDateKey(new Date());
      const newClient: Client = {
        id: crypto.randomUUID(),
        unitId,
        name,
        cedula: cedula || undefined,
        rentAmount: 0,
        frequency: "monthly",
        monthlyChargeDay: 1,
        installmentsAgreed: 0,
        installmentsRemaining: 0,
        installmentsPaid: 0,
        otherCharges: [],
        balance: 0,
        advanceBalance: 0,
        savings: 0,
        travelFundBalance: 0,
        createdAt: new Date().toISOString(),
        firstChargeDate: today,
        lastChargeDate: today,
        status: "activo",
        statusComment: undefined
      };

      const next = clients.map((client) => {
        if (client.unitId === unitId) {
          return {
            ...client,
            status: "archivado" as const,
            statusComment: "Inactivado por reasignacion de unidad.",
            archivedAt: client.archivedAt ?? new Date().toISOString()
          };
        }
        return client;
      });
      await onClientsChange([...next, newClient]);
      setRows((current) =>
        current.map((row) => {
          if (row.unit_id !== unitId) return row;
          return {
            ...row,
            client_id: newClient.id,
            client_name: newClient.name,
            client_cedula: newClient.cedula ?? null,
            operational_status: "activo"
          };
        })
      );
      setAssignDialog({ unitId: "", name: "", cedula: "" });
    } catch (error) {
      console.error("No se pudo asignar cliente a unidad libre.", error);
      setAssignError("No se pudo guardar la asignacion. Intenta nuevamente.");
    } finally {
      setAssignSaving(false);
    }
  }

  async function handleSaveBilling(client: Client): Promise<void> {
    const draft = billingDraftByClientId[client.id];
    if (!draft) return;
    setBillingSavingByClientId((current) => ({ ...current, [client.id]: true }));
    setBillingErrorByClientId((current) => ({ ...current, [client.id]: "" }));
    try {
      const nextClients = clients.map((item) => (item.id === client.id ? { ...item, ...draft } : item));
      await onClientsChange(nextClients);
      setBillingDraftByClientId((current) => {
        const next = { ...current };
        delete next[client.id];
        return next;
      });
    } catch (error) {
      console.error("No se pudo guardar datos de cobranza.", error);
      setBillingErrorByClientId((current) => ({ ...current, [client.id]: "No se pudo guardar cobranza." }));
    } finally {
      setBillingSavingByClientId((current) => ({ ...current, [client.id]: false }));
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Control de Unidades</h2>
      </div>

      <p className="hint" style={{ marginTop: 6 }}>
        Vista consolidada operativa + financiera. Total unidades: {rows.length}
      </p>

      <div className="filters-bar" style={{ gridTemplateColumns: "1.5fr 1fr 1fr 1fr auto", marginTop: 10 }}>
        <input
          type="text"
          placeholder="Buscar por unidad, placa o cliente"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
          <option value="all">Todos los grupos</option>
          {groups.map((group) => (
            <option key={group} value={group}>Grupo {group}</option>
          ))}
        </select>

        <select
          value={operationalFilter}
          onChange={(event) => setOperationalFilter(event.target.value as OperationalFilter)}
        >
          <option value="all">Estado operativo (todos)</option>
          <option value="activo">Activo</option>
          <option value="cliente_enfermo">Cliente enfermo</option>
          <option value="taller">Taller</option>
          <option value="chapisteria">Chapisteria</option>
          <option value="custodia">Custodia</option>
          <option value="en_busqueda">En busqueda</option>
          <option value="archivado">Archivado</option>
          <option value="sin_estado">Sin estado</option>
        </select>

        <select value={financialFilter} onChange={(event) => setFinancialFilter(event.target.value as FinancialFilter)}>
          <option value="all">Estado financiero (todos)</option>
          <option value="moroso">Moroso</option>
          <option value="al_dia">Al dia</option>
          <option value="sin_cliente">Sin cliente</option>
        </select>

        <label style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600, fontSize: "0.85rem" }}>
          <input
            type="checkbox"
            checked={onlyFree}
            onChange={(event) => setOnlyFree(event.target.checked)}
            style={{ marginRight: 8 }}
          />
          Solo libres
        </label>
      </div>

      {loadError && <p className="hint error-text">{loadError}</p>}

      {loading ? (
        <p className="hint">Cargando unidades...</p>
      ) : (
        <>
          <p className="hint">Mostrando {filteredRows.length} unidades.</p>
          <div className="table-scroll" style={{ borderTop: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
            <table className="ar-table ar-table--compact">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("unit")}>
                      Unidad <span className={`sort-icon ${sortField === "unit" ? "active" : ""}`}>{sortIcon("unit")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("operational")}>
                      Estado operativo <span className={`sort-icon ${sortField === "operational" ? "active" : ""}`}>{sortIcon("operational")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("cobranza")}>
                      Cobranza <span className={`sort-icon ${sortField === "cobranza" ? "active" : ""}`}>{sortIcon("cobranza")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("info")}>
                      +Info <span className={`sort-icon ${sortField === "info" ? "active" : ""}`}>{sortIcon("info")}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                      No hay resultados para los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const isFree = !row.client_id;
                    const balance = normalizeBalance(row.financial_balance);
                    const rowKey = `${row.user_id}-${row.unit_id}`;
                    const isExpanded = expandedInfoKey === rowKey;
                    const activeInfoSection = infoSectionByRowKey[rowKey] ?? "unidad";
                    const linkedClient = row.client_id ? clients.find((item) => item.id === row.client_id) : undefined;
                    const otherChargesTotal = linkedClient?.otherCharges?.reduce((sum, item) => sum + (item.amount || 0), 0) ?? 0;
                    const billingDraft = linkedClient ? billingDraftByClientId[linkedClient.id] : undefined;
                    const currentBilling = linkedClient ? {
                      rentAmount: billingDraft?.rentAmount ?? linkedClient.rentAmount,
                      frequency: billingDraft?.frequency ?? linkedClient.frequency,
                      installmentsAgreed: billingDraft?.installmentsAgreed ?? linkedClient.installmentsAgreed,
                      installmentsRemaining: billingDraft?.installmentsRemaining ?? linkedClient.installmentsRemaining,
                      installmentsPaid: billingDraft?.installmentsPaid ?? linkedClient.installmentsPaid
                    } : undefined;
                    const debtSince = linkedClient ? (linkedClient.lastChargeDate ?? linkedClient.firstChargeDate) : undefined;
                    const debtDays = daysSince(debtSince);
                    return (
                      <Fragment key={rowKey}>
                        <tr key={rowKey} className={isFree ? "control-unit-row--free" : ""}>
                          <td>
                            <strong>{row.unit_id}</strong>
                            {isFree && <span className="badge control-unit-badge-free">Libre</span>}
                            <div className="debt-meta ar-truncate-line" title={row.client_name ?? "Sin cliente"} style={{ cursor: "help" }}>
                              {row.client_name ?? "Sin cliente"}
                            </div>
                          </td>
                          <td>
                            <span className={operationalToneClass(row.operational_status)}>
                              {operationalLabel(row.operational_status)}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${row.financial_status === "moroso" ? "badge-debt" : row.financial_status === "al_dia" ? "badge-good" : "badge-warning"}`}>
                              {financialLabel(row.financial_status)}
                            </span>
                            <div style={{ marginTop: 6 }}>
                              <span className={balance > 0 ? "amount-debt" : "amount-good"}>{formatMoney(balance)}</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {isFree && (
                                <button
                                  type="button"
                                  className="button primary small"
                                  onClick={() => {
                                    setAssignDialog({ unitId: row.unit_id, name: "", cedula: "" });
                                    setAssignError("");
                                  }}
                                >
                                  Agregar cliente
                                </button>
                              )}
                              <button
                                type="button"
                                className="button ghost small"
                                onClick={() => {
                                  setExpandedInfoKey((current) => (current === rowKey ? null : rowKey));
                                  setInfoSectionByRowKey((current) => ({ ...current, [rowKey]: current[rowKey] ?? "unidad" }));
                                }}
                              >
                                {isExpanded ? "-info" : "+info"}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="control-unit-info-row" key={`${rowKey}-info`}>
                            <td colSpan={4}>
                              <div className="cash-view-tabs" style={{ marginBottom: 12 }}>
                                <button
                                  type="button"
                                  className={`button ghost small ${activeInfoSection === "unidad" ? "cash-tab-active" : ""}`}
                                  onClick={() => setInfoSectionByRowKey((current) => ({ ...current, [rowKey]: "unidad" }))}
                                >
                                  Sobre la unidad
                                </button>
                                <button
                                  type="button"
                                  className={`button ghost small ${activeInfoSection === "cliente" ? "cash-tab-active" : ""}`}
                                  onClick={() => setInfoSectionByRowKey((current) => ({ ...current, [rowKey]: "cliente" }))}
                                >
                                  Sobre el cliente
                                </button>
                                <button
                                  type="button"
                                  className={`button ghost small ${activeInfoSection === "cobranza" ? "cash-tab-active" : ""}`}
                                  onClick={() => setInfoSectionByRowKey((current) => ({ ...current, [rowKey]: "cobranza" }))}
                                >
                                  Sobre cobranza
                                </button>
                              </div>

                              {activeInfoSection === "unidad" ? (
                                <div className="control-unit-info-grid">
                                  <div><span className="hint">Placa</span><p>{row.plate ?? "-"}</p></div>
                                  <div><span className="hint">Marca/Modelo</span><p>{row.brand_model ?? "-"}</p></div>
                                  <div><span className="hint">Empresa</span><p>{row.company ?? "-"}</p></div>
                                  <div><span className="hint">Serial Motor</span><p>{row.engine_serial ?? "-"}</p></div>
                                  <div><span className="hint">Serial Chasis</span><p>{row.chassis_serial ?? "-"}</p></div>
                                  <div><span className="hint">Cupo</span><p>{row.cupo ?? "-"}</p></div>
                                  <div style={{ gridColumn: "1 / -1" }}><span className="hint">Observacion</span><p>{row.observation ?? "-"}</p></div>
                                </div>
                              ) : null}

                              {activeInfoSection === "cliente" ? (
                                <div className="control-unit-info-grid">
                                  <div><span className="hint">Nombre</span><p>{row.client_name ?? "-"}</p></div>
                                  <div><span className="hint">Cedula</span><p>{row.client_cedula ?? "-"}</p></div>
                                  <div><span className="hint">Estado operativo</span><p>{operationalLabel(row.operational_status)}</p></div>
                                </div>
                              ) : null}

                              {activeInfoSection === "cobranza" ? (
                                <div style={{ display: "grid", gap: 12 }}>
                                  <div className="cash-subpanel control-billing-kpis">
                                    <div className="control-billing-kpi-grid">
                                      <div className="control-billing-kpi-card">
                                        <span className="hint">Estado financiero</span>
                                        <p style={{ marginTop: 6 }}>
                                          <span className={`badge ${row.financial_status === "moroso" ? "badge-debt" : row.financial_status === "al_dia" ? "badge-good" : "badge-warning"}`}>
                                            {financialLabel(row.financial_status)}
                                          </span>
                                        </p>
                                      </div>
                                      <div className="control-billing-kpi-card">
                                        <span className="hint">Saldo</span>
                                        <p style={{ marginTop: 6 }} className={balance > 0 ? "amount-debt" : "amount-good"}>{formatMoney(balance)}</p>
                                      </div>
                                      <div className="control-billing-kpi-card">
                                        <span className="hint">Debe desde</span>
                                        <p style={{ marginTop: 6 }} className={debtSinceTone(debtDays)}>
                                          {debtSince ?? "-"}{debtDays !== null ? ` (${debtDays} dias)` : ""}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="cash-subpanel">
                                    <h3>Editable</h3>
                                    <div className="control-billing-edit-grid">
                                      {linkedClient && currentBilling ? (
                                        <>
                                          <div className="control-field">
                                            <span className="hint">Renta</span>
                                            <input
                                              type="number"
                                              value={currentBilling.rentAmount}
                                              onChange={(event) => {
                                                const value = Number(event.target.value || "0");
                                                setBillingDraftByClientId((current) => ({
                                                  ...current,
                                                  [linkedClient.id]: {
                                                    ...currentBilling,
                                                    rentAmount: Number.isFinite(value) ? value : 0
                                                  }
                                                }));
                                              }}
                                              disabled={billingSavingByClientId[linkedClient.id]}
                                            />
                                          </div>
                                          <div className="control-field">
                                            <span className="hint">Frecuencia</span>
                                            <select
                                              value={currentBilling.frequency}
                                              onChange={(event) => setBillingDraftByClientId((current) => ({
                                                ...current,
                                                [linkedClient.id]: { ...currentBilling, frequency: event.target.value as Client["frequency"] }
                                              }))}
                                              disabled={billingSavingByClientId[linkedClient.id]}
                                            >
                                              <option value="daily">Diaria</option>
                                              <option value="weekly">Semanal</option>
                                              <option value="biweekly">Quincenal</option>
                                              <option value="monthly">Mensual</option>
                                            </select>
                                          </div>
                                          <div className="control-field">
                                            <span className="hint">Cuotas pactadas</span>
                                            <input type="number" value={currentBilling.installmentsAgreed} onChange={(event) => setBillingDraftByClientId((current) => ({ ...current, [linkedClient.id]: { ...currentBilling, installmentsAgreed: Number(event.target.value || "0") } }))} disabled={billingSavingByClientId[linkedClient.id]} />
                                          </div>
                                          <div className="control-field">
                                            <span className="hint">Cuotas restantes</span>
                                            <input type="number" value={currentBilling.installmentsRemaining} onChange={(event) => setBillingDraftByClientId((current) => ({ ...current, [linkedClient.id]: { ...currentBilling, installmentsRemaining: Number(event.target.value || "0") } }))} disabled={billingSavingByClientId[linkedClient.id]} />
                                          </div>
                                          <div className="control-field">
                                            <span className="hint">Cuotas pagadas</span>
                                            <input type="number" value={currentBilling.installmentsPaid} onChange={(event) => setBillingDraftByClientId((current) => ({ ...current, [linkedClient.id]: { ...currentBilling, installmentsPaid: Number(event.target.value || "0") } }))} disabled={billingSavingByClientId[linkedClient.id]} />
                                          </div>
                                          <div className="control-billing-save-row">
                                            <button type="button" className="button primary" onClick={() => void handleSaveBilling(linkedClient)} disabled={billingSavingByClientId[linkedClient.id]}>
                                              {billingSavingByClientId[linkedClient.id] ? "Guardando..." : "Guardar cambios"}
                                            </button>
                                          </div>
                                        </>
                                      ) : (
                                        <div style={{ gridColumn: "1 / -1" }}><p className="hint">No hay cliente asignado para editar cobranza.</p></div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="cash-subpanel">
                                    <h3>Solo lectura</h3>
                                    <div className="control-unit-info-grid">
                                      <div><span className="hint">Otros cargos</span><p>{linkedClient ? `${linkedClient.otherCharges.length} (${formatMoney(otherChargesTotal)})` : "-"}</p></div>
                                      <div><span className="hint">Ahorro de siniestros</span><p>{linkedClient ? formatMoney(linkedClient.savings) : "-"}</p></div>
                                    </div>
                                  </div>
                                  {linkedClient && billingErrorByClientId[linkedClient.id] ? <p className="hint error-text">{billingErrorByClientId[linkedClient.id]}</p> : null}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {statusError && <p className="hint error-text">{statusError}</p>}

      {statusDialog && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Confirmar cambio de estado</h2>
              <button type="button" className="modal-close" onClick={() => setStatusDialog(null)}>X</button>
            </div>
            <div className="modal-body">
              <p className="hint" style={{ marginTop: 0 }}>
                Este estado requiere motivo. Completa el comentario para continuar.
              </p>
              <label style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>
                Motivo
                <textarea
                  className="pause-comment-input"
                  rows={3}
                  maxLength={200}
                  value={statusDialog.comment}
                  onChange={(event) => setStatusDialog((current) => (current ? { ...current, comment: event.target.value } : current))}
                  placeholder="Escribe el motivo del cambio"
                />
              </label>
              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="button ghost" onClick={() => setStatusDialog(null)} disabled={statusSaving}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={statusSaving || statusDialog.comment.trim().length === 0}
                  onClick={() => void handleApplyStatus(statusDialog.clientId, statusDialog.nextStatus, statusDialog.comment)}
                >
                  {statusSaving ? "Guardando..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {assignDialog.unitId && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Agregar cliente unidad {assignDialog.unitId}</h2>
              <button type="button" className="modal-close" onClick={() => setAssignDialog({ unitId: "", name: "", cedula: "" })}>X</button>
            </div>
            <div className="modal-body">
              <label style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>
                Nombre del cliente
                <input
                  type="text"
                  value={assignDialog.name}
                  onChange={(event) => setAssignDialog((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Ejemplo: Juan Perez"
                />
              </label>
              <label style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600, marginTop: 10, display: "block" }}>
                Cedula (opcional)
                <input
                  type="text"
                  value={assignDialog.cedula}
                  onChange={(event) => setAssignDialog((current) => ({ ...current, cedula: event.target.value }))}
                  placeholder="Ejemplo: 8-123-456"
                />
              </label>
              {assignError && <p className="hint error-text">{assignError}</p>}
              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="button ghost" onClick={() => setAssignDialog({ unitId: "", name: "", cedula: "" })} disabled={assignSaving}>
                  Cancelar
                </button>
                <button type="button" className="button primary" onClick={() => void handleAssignClientToUnit()} disabled={assignSaving || assignDialog.name.trim().length === 0}>
                  {assignSaving ? "Guardando..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}






