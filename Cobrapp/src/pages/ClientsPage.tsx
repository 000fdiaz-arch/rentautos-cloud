import { useEffect, useMemo, useRef, useState } from "react";
import {
  findNextChargeDay,
  getDebtStartDate,
  getPendingInstallments,
  parseDateKey,
  startOfDay,
  toDateKey
} from "../billing";
import { exportClientsToExcel, exportClientsToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import type { BillingFrequency, Client, OtherCharge, WeeklyChargeDay } from "../types";

type ExportFieldKey =
  | "unitId" | "cedula" | "name" | "rentAmount" | "frequency"
  | "installmentsAgreed" | "installmentsRemaining" | "installmentsPaid"
  | "otherCharges" | "balance" | "siniestrosSavings" | "debtSince";

type ExportField = { key: ExportFieldKey; label: string; enabled: boolean };

const INITIAL_EXPORT_FIELDS: ExportField[] = [
  { key: "unitId",                label: "UNIDAD/ID",        enabled: true },
  { key: "cedula",                label: "Cedula",            enabled: true },
  { key: "name",                  label: "Cliente",           enabled: true },
  { key: "rentAmount",            label: "Renta (USD)",       enabled: true },
  { key: "frequency",             label: "Frecuencia",        enabled: true },
  { key: "installmentsAgreed",    label: "Cuotas pactadas",   enabled: true },
  { key: "installmentsRemaining", label: "Cuotas restantes",  enabled: true },
  { key: "installmentsPaid",      label: "Cuotas pagadas",    enabled: true },
  { key: "otherCharges",          label: "Otros cargos",      enabled: true },
  { key: "balance",               label: "Monto a cobrar",    enabled: true },
  { key: "siniestrosSavings",     label: "Ahorro de siniestros", enabled: true },
  { key: "debtSince",             label: "Debe desde",        enabled: true },
];

const FREQUENCY_LABEL: Record<BillingFrequency, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual"
};

type OtherChargeForm = { id: string; label: string; amount: string };

type ClientForm = {
  unitId: string;
  cedula: string;
  name: string;
  firstChargeDate: string;
  rentAmount: string;
  frequency: BillingFrequency;
  chargeFirstSunday: boolean;
  initialBalance: string;
  weeklyChargeDay: WeeklyChargeDay;
  monthlyChargeDay: string;
  installmentsAgreed: string;
  installmentsRemaining: string;
  installmentsPaid: string;
  otherCharges: OtherChargeForm[];
};

type SortField = "unitId" | "name" | "frequency" | "rentAmount" | "balance" | "debtDate" | "status";
type SortDirection = "asc" | "desc";
type StatusFilter = "all" | "active" | "inactive" | "archived";
const STATUS_FILTER_STORAGE_KEY = "cobrapp.clients.status_filter.v1";
const CASH_CLOSINGS_KEY = "cobrapp.module2.cash_closings.v1";

const initialForm: ClientForm = {
  unitId: "",
  cedula: "",
  name: "",
  firstChargeDate: toDateKey(new Date()),
  rentAmount: "",
  frequency: "monthly",
  chargeFirstSunday: false,
  initialBalance: "",
  weeklyChargeDay: "monday",
  monthlyChargeDay: "1",
  installmentsAgreed: "",
  installmentsRemaining: "",
  installmentsPaid: "",
  otherCharges: []
};

function parseNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

function createOtherChargeForm(initial?: Partial<OtherChargeForm>): OtherChargeForm {
  return {
    id: initial?.id && initial.id.trim() ? initial.id : crypto.randomUUID(),
    label: initial?.label ?? "",
    amount: initial?.amount ?? ""
  };
}

function hasBillingRuleChanged(existing: Client, form: ClientForm): boolean {
  if (existing.frequency !== form.frequency) return true;
  if (form.frequency === "weekly") return (existing.weeklyChargeDay ?? "monday") !== form.weeklyChargeDay;
  if (form.frequency === "monthly") return (existing.monthlyChargeDay ?? 1) !== Number(form.monthlyChargeDay);
  return false;
}

function extractGroupCode(unitId: string): string {
  const match = unitId.trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : "";
}

function getOperationalReferenceDate(now: Date): Date {
  const today = startOfDay(now);
  try {
    const raw = window.localStorage.getItem(CASH_CLOSINGS_KEY);
    if (!raw) return today;
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return today;

    const candidates = parsed
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const rec = item as Record<string, unknown>;
        return typeof rec.date === "string" ? rec.date.trim() : "";
      })
      .filter((dateKey) => dateKey.length > 0);

    if (candidates.length === 0) return today;

    const latestClosed = [...new Set(candidates)].sort().at(-1);
    if (!latestClosed) return today;
    const latestClosedDate = parseDateKey(latestClosed);
    if (!latestClosedDate) return today;
    const nextOperational = new Date(latestClosedDate);
    nextOperational.setDate(nextOperational.getDate() + 1);
    return startOfDay(nextOperational);
  } catch {
    return today;
  }
}

function buildClient(form: ClientForm, existing?: Client): Client {
  const otherCharges: OtherCharge[] = form.otherCharges
    .filter((c) => c.label.trim() && parseNumberOrNull(c.amount) !== null)
    .map((c) => ({
      id: c.id && c.id.trim() ? c.id.trim() : crypto.randomUUID(),
      label: c.label.trim(),
      amount: Number(c.amount)
    }));

  const now = new Date();
  const todayKey = toDateKey(now);
  const normalizedFirstChargeDate = form.firstChargeDate.trim() || existing?.firstChargeDate || todayKey;
  const firstChargeDate = parseDateKey(normalizedFirstChargeDate) ? normalizedFirstChargeDate : todayKey;
  const firstChargeAnchor = parseDateKey(firstChargeDate) ?? startOfDay(now);
  const firstChargeLastDate = toDateKey(new Date(firstChargeAnchor.getFullYear(), firstChargeAnchor.getMonth(), firstChargeAnchor.getDate() - 1));
  const resetLastChargeDate = existing ? hasBillingRuleChanged(existing, form) : false;

  const client: Client = {
    id: existing?.id ?? crypto.randomUUID(),
    unitId: form.unitId.trim(),
    cedula: form.cedula.trim() || undefined,
    name: form.name.trim(),
    rentAmount: Number(form.rentAmount),
    frequency: form.frequency,
    chargeFirstSunday: form.frequency === "daily" ? form.chargeFirstSunday : false,
    firstSundayChargedAt: existing?.firstSundayChargedAt,
    balance: Number(form.initialBalance),
    advanceBalance: existing?.advanceBalance ?? 0,
    savings: existing?.savings ?? 0,
    installmentsAgreed: Number(form.installmentsAgreed),
    installmentsRemaining: Number(form.installmentsRemaining),
    installmentsPaid: Number(form.installmentsPaid),
    otherCharges,
    createdAt: existing?.createdAt ?? now.toISOString(),
    firstChargeDate,
    lastChargeDate: resetLastChargeDate
      ? firstChargeLastDate
      : (existing?.lastChargeDate ?? firstChargeLastDate),
    archivedAt: existing?.archivedAt,
    status: existing?.status ?? "active",
    statusComment: existing?.statusComment
  };

  if (form.frequency === "weekly") client.weeklyChargeDay = form.weeklyChargeDay;
  if (form.frequency === "monthly") client.monthlyChargeDay = Number(form.monthlyChargeDay);
  return client;
}

type Props = {
  clients: Client[];
  onClientsChange: (next: Client[]) => void;
};

export default function ClientsPage({ clients, onClientsChange }: Props) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [form, setForm] = useState<ClientForm>(initialForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [errorFields, setErrorFields] = useState<Set<string>>(new Set());
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(clients.length === 0);
  const [searchTerm, setSearchTerm] = useState("");
  const [frequencyFilter, setFrequencyFilter] = useState<"all" | BillingFrequency>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [debtFilter, setDebtFilter] = useState<"all" | "withDebt" | "withoutDebt">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    try {
      const saved = window.localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
      if (saved === "active" || saved === "inactive" || saved === "archived" || saved === "all") return saved;
    } catch {
      // Ignore storage errors and default to active.
    }
    return "active";
  });
  const [sortField, setSortField] = useState<SortField>("unitId");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    variant: "warning" | "danger";
    onConfirm: () => void;
  } | null>(null);
  const [pauseDialog, setPauseDialog] = useState<{
    clientId: string;
    comment: string;
  } | null>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topScrollInnerRef = useRef<HTMLDivElement>(null);

  const activeClientsCount = useMemo(
    () => clients.filter((client) => !client.archivedAt && client.status === "active").length,
    [clients]
  );
  const inactiveClientsCount = useMemo(
    () => clients.filter((client) => !client.archivedAt && client.status === "inactive").length,
    [clients]
  );
  const operationalReferenceDate = useMemo(() => getOperationalReferenceDate(now), [now]);
  const availableGroups = useMemo(() => {
    return [...new Set(clients.map((c) => extractGroupCode(c.unitId)).filter((g) => g.length > 0))].sort((a, b) => a.localeCompare(b));
  }, [clients]);

  const rows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const baseRows = clients.map((client) => {
      const debtStartDate = getDebtStartDate(client, operationalReferenceDate);
      const nextChargeDate = debtStartDate ? null : findNextChargeDay(client, operationalReferenceDate);
      const pendingInstallments = getPendingInstallments(client);
      return { client, debtStartDate, nextChargeDate, pendingInstallments };
    });

    const filtered = baseRows.filter(({ client, debtStartDate }) => {
      if (statusFilter === "active" && (client.archivedAt || client.status !== "active")) return false;
      if (statusFilter === "inactive" && (client.archivedAt || client.status !== "inactive")) return false;
      if (statusFilter === "archived" && !client.archivedAt) return false;
      if (frequencyFilter !== "all" && client.frequency !== frequencyFilter) return false;
      if (groupFilter !== "all" && extractGroupCode(client.unitId) !== groupFilter) return false;
      if (debtFilter === "withDebt" && debtStartDate === null) return false;
      if (debtFilter === "withoutDebt" && debtStartDate !== null) return false;
      if (!normalizedSearch) return true;
      return `${client.unitId} ${client.name} ${client.cedula ?? ""}`.toLowerCase().includes(normalizedSearch);
    });

    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortField === "unitId") comparison = a.client.unitId.localeCompare(b.client.unitId);
      if (sortField === "name") comparison = a.client.name.localeCompare(b.client.name);
      if (sortField === "frequency") {
        comparison = FREQUENCY_LABEL[a.client.frequency].localeCompare(FREQUENCY_LABEL[b.client.frequency]);
      }
      if (sortField === "rentAmount") comparison = a.client.rentAmount - b.client.rentAmount;
      if (sortField === "balance") comparison = a.client.balance - b.client.balance;
      if (sortField === "debtDate") {
        const aTime = a.debtStartDate ? a.debtStartDate.getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.debtStartDate ? b.debtStartDate.getTime() : Number.POSITIVE_INFINITY;
        comparison = aTime - bTime;
      }
      if (sortField === "status") comparison = a.client.status.localeCompare(b.client.status);
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [clients, debtFilter, frequencyFilter, groupFilter, operationalReferenceDate, searchTerm, sortDirection, sortField, statusFilter]);

  function persist(next: Client[]): void {
    onClientsChange(next);
  }

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (topScrollInnerRef.current && tableScrollRef.current) {
      topScrollInnerRef.current.style.width = `${tableScrollRef.current.scrollWidth}px`;
    }
  }, [rows]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STATUS_FILTER_STORAGE_KEY, statusFilter);
    } catch {
      // Ignore storage errors.
    }
  }, [statusFilter]);

  function handleTopScroll() {
    if (tableScrollRef.current && topScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }

  function handleTableScroll() {
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  }

  function recalculateInstallments(nextForm: ClientForm): ClientForm {
    const agreed = parseIntegerOrNull(nextForm.installmentsAgreed);
    const remaining = parseIntegerOrNull(nextForm.installmentsRemaining);
    if (agreed === null && remaining === null) return { ...nextForm, installmentsPaid: "" };
    if (agreed === null) return { ...nextForm, installmentsPaid: "" };
    if (remaining === null) return { ...nextForm, installmentsPaid: String(agreed) };
    return { ...nextForm, installmentsPaid: String(Math.max(agreed - remaining, 0)) };
  }

  const installmentLiveError = useMemo(() => {
    const agreed = parseIntegerOrNull(form.installmentsAgreed);
    const remaining = parseIntegerOrNull(form.installmentsRemaining);
    if (form.installmentsAgreed.trim() !== "" && agreed === null) return "Cuotas pactadas debe ser un numero entero mayor o igual a 0.";
    if (form.installmentsRemaining.trim() !== "" && remaining === null) return "Cuotas restantes debe ser un numero entero mayor o igual a 0.";
    if (agreed !== null && agreed < 0) return "Cuotas pactadas no puede ser negativa.";
    if (remaining !== null && remaining < 0) return "Cuotas restantes no puede ser negativa.";
    if (agreed !== null && remaining !== null && remaining > agreed) return "Error: las cuotas restantes no pueden ser mayores que las cuotas pactadas.";
    return null;
  }, [form.installmentsAgreed, form.installmentsRemaining]);

  function validate(input: ClientForm, currentEditingId: string | null): { messages: string[]; fields: Set<string> } {
    const messages: string[] = [];
    const fields = new Set<string>();

    if (!input.unitId.trim()) { messages.push("UNIDAD/ID es obligatorio."); fields.add("unitId"); }
    const normalizedUnit = input.unitId.trim().toLowerCase();
    const duplicated = clients.some(
      (client) => client.id !== currentEditingId && client.unitId.trim().toLowerCase() === normalizedUnit
    );
    if (duplicated) { messages.push("UNIDAD/ID ya existe. No se permiten duplicados."); fields.add("unitId"); }
    if (!input.name.trim()) { messages.push("El nombre del cliente es obligatorio."); fields.add("name"); }
    const firstChargeDate = parseDateKey(input.firstChargeDate.trim());
    if (!firstChargeDate) {
      messages.push("La fecha de primer cobro es obligatoria.");
      fields.add("firstChargeDate");
    } else {
      const today = startOfDay(new Date());
      if (startOfDay(firstChargeDate) < today) {
        messages.push("La fecha de primer cobro no puede ser menor a hoy.");
        fields.add("firstChargeDate");
      }
    }

    const rentAmount = Number(input.rentAmount);
    if (!Number.isFinite(rentAmount) || rentAmount < 0) {
      messages.push("La renta debe ser un numero mayor o igual a 0.");
      fields.add("rentAmount");
    }

    const initialBalance = Number(input.initialBalance);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      messages.push("El MONTO A COBRAR debe ser un numero valido mayor o igual a 0.");
      fields.add("initialBalance");
    }

    const agreed = Number(input.installmentsAgreed);
    const remaining = Number(input.installmentsRemaining);
    const paid = Number(input.installmentsPaid);
    if (
      !Number.isFinite(agreed) || !Number.isFinite(remaining) || !Number.isFinite(paid) ||
      !Number.isInteger(agreed) || !Number.isInteger(remaining) || !Number.isInteger(paid) ||
      agreed < 0 || remaining < 0 || paid < 0
    ) {
      messages.push("Las cuotas deben ser enteros validos mayores o iguales a 0.");
      fields.add("installmentsAgreed"); fields.add("installmentsRemaining");
    } else if (remaining > agreed) {
      messages.push("Las cuotas restantes no pueden ser mayores que las cuotas pactadas.");
      fields.add("installmentsAgreed"); fields.add("installmentsRemaining");
    } else if (paid !== agreed - remaining) {
      messages.push("Las cuotas no cuadran. Pagadas debe ser Pactadas menos Restantes.");
      fields.add("installmentsAgreed"); fields.add("installmentsRemaining");
    }

    if (input.frequency === "monthly") {
      const monthlyChargeDay = Number(input.monthlyChargeDay);
      if (!Number.isInteger(monthlyChargeDay) || monthlyChargeDay < 1 || monthlyChargeDay > 31) {
        messages.push("Para mensual, el dia de cobro debe estar entre 1 y 31.");
        fields.add("monthlyChargeDay");
      }
    }

    for (const charge of input.otherCharges) {
      const hasLabel = charge.label.trim().length > 0;
      const amount = parseNumberOrNull(charge.amount);
      if (hasLabel && amount === null) { messages.push("Cada cargo adicional debe tener un monto valido."); break; }
      if (!hasLabel && amount !== null) { messages.push("Cada cargo adicional debe tener un concepto."); break; }
    }

    return { messages, fields };
  }

  function handleInstallmentChange(field: "installmentsAgreed" | "installmentsRemaining", value: string): void {
    setForm((current) => recalculateInstallments({ ...current, [field]: value }));
  }

  function handleSubmitClient(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalizedForm = recalculateInstallments(form);
    setForm(normalizedForm);

    const { messages: nextErrors, fields: nextFields } = validate(normalizedForm, editingClientId);
    setErrors(nextErrors);
    setErrorFields(nextFields);
    if (nextErrors.length > 0) return;

    if (editingClientId !== null) {
      const existing = clients.find((client) => client.id === editingClientId);
      if (!existing) { setErrors(["No se encontro el cliente a editar."]); return; }
      persist(clients.map((client) => client.id === editingClientId ? buildClient(normalizedForm, existing) : client));
    } else {
      persist([...clients, buildClient(normalizedForm)]);
    }

    setForm(initialForm);
    setErrors([]);
    setErrorFields(new Set());
    setEditingClientId(null);
    setIsFormOpen(false);
  }

  function handleStartEditClient(client: Client): void {
    const nextForm: ClientForm = {
      unitId: client.unitId,
      cedula: client.cedula ?? "",
      name: client.name,
      firstChargeDate: client.firstChargeDate ?? toDateKey(new Date()),
      rentAmount: String(client.rentAmount),
      frequency: client.frequency,
      chargeFirstSunday: client.chargeFirstSunday ?? false,
      initialBalance: String(client.balance),
      weeklyChargeDay: client.weeklyChargeDay ?? "monday",
      monthlyChargeDay: String(client.monthlyChargeDay ?? 1),
      installmentsAgreed: String(client.installmentsAgreed),
      installmentsRemaining: String(client.installmentsRemaining),
      installmentsPaid: String(client.installmentsPaid),
      otherCharges: client.otherCharges.map((c) =>
        createOtherChargeForm({ id: c.id, label: c.label, amount: String(c.amount) })
      )
    };
    setForm(recalculateInstallments(nextForm));
    setErrors([]);
    setErrorFields(new Set());
    setEditingClientId(client.id);
  }

  function handleCancelEdit(): void {
    setEditingClientId(null);
    setForm(initialForm);
    setErrors([]);
    setErrorFields(new Set());
    setIsFormOpen(false);
  }

  function handleArchiveClient(clientId: string): void {
    setConfirmDialog({
      title: "Archivar cliente",
      message: "Este cliente quedara archivado y dejara de acumular cobros automaticos.",
      variant: "warning",
      onConfirm: () => {
        const archivedAt = new Date().toISOString();
        persist(clients.map((client) => (client.id === clientId ? { ...client, archivedAt } : client)));
        setConfirmDialog(null);
      }
    });
  }

  function handleRestoreClient(clientId: string): void {
    setConfirmDialog({
      title: "Restaurar cliente",
      message: "Se reactivara el cliente. El corte de cobro se reiniciara desde hoy.",
      variant: "warning",
      onConfirm: () => {
        const todayKey = toDateKey(new Date());
        persist(clients.map((client) =>
          client.id === clientId ? { ...client, archivedAt: undefined, lastChargeDate: todayKey } : client
        ));
        setConfirmDialog(null);
      }
    });
  }

  function handleDeleteClient(clientId: string): void {
    setConfirmDialog({
      title: "Eliminar cliente",
      message: "Esta accion eliminara el cliente de forma permanente y no se puede deshacer.",
      variant: "danger",
      onConfirm: () => {
        persist(clients.filter((client) => client.id !== clientId));
        if (editingClientId === clientId) {
          setEditingClientId(null);
          setForm(initialForm);
          setErrors([]);
          setErrorFields(new Set());
        }
        setConfirmDialog(null);
      }
    });
  }

  function handleToggleStatus(client: Client): void {
    if (client.status === "inactive") {
      persist(clients.map((c) =>
        c.id === client.id ? { ...c, status: "active" as const, statusComment: undefined, lastChargeDate: toDateKey(new Date()) } : c
      ));
    } else {
      setPauseDialog({ clientId: client.id, comment: "" });
    }
  }

  function handleConfirmPause(): void {
    if (!pauseDialog) return;
    const comment = pauseDialog.comment.trim();
    if (!comment) return;
    persist(clients.map((c) =>
      c.id === pauseDialog.clientId ? { ...c, status: "inactive" as const, statusComment: comment } : c
    ));
    setPauseDialog(null);
  }

  function handleSort(field: SortField): void {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  }

  type RowData = typeof rows[number];

  function getExportCell(key: ExportFieldKey, row: RowData): string | number {
    const { client, debtStartDate, nextChargeDate } = row;
    switch (key) {
      case "unitId":                return client.unitId;
      case "cedula":                return client.cedula ?? "-";
      case "name":                  return client.name;
      case "rentAmount":            return client.rentAmount;
      case "frequency":             return FREQUENCY_LABEL[client.frequency];
      case "installmentsAgreed":    return client.installmentsAgreed;
      case "installmentsRemaining": return client.installmentsRemaining;
      case "installmentsPaid":      return client.installmentsPaid;
      case "otherCharges":
        return client.otherCharges.length > 0
          ? client.otherCharges.map((c) => `${c.label}: ${formatCurrency(c.amount)}`).join(" | ")
          : "-";
      case "balance":               return client.balance;
      case "siniestrosSavings":     return client.savings;
      case "debtSince":
        if (debtStartDate) return formatDate(debtStartDate);
        if (nextChargeDate) return `Al dia (prox. ${formatDate(nextChargeDate)})`;
        return "Al dia";
    }
  }

  function buildExportData(): { headers: string[]; body: (string | number)[][] } {
    const active = exportFields.filter((f) => f.enabled);
    const headers = active.map((f) => f.label);
    const body = rows.map((row) => active.map((f) => getExportCell(f.key, row)));
    return { headers, body };
  }

  async function handleExportExcel(): Promise<void> {
    const { headers, body } = buildExportData();
    setIsExporting(true);
    setExportError(null);
    try {
      await exportClientsToExcel(headers, body, new Date());
    } catch {
      setExportError("No fue posible generar el archivo Excel.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportPDF(): Promise<void> {
    const { headers, body } = buildExportData();
    setIsExporting(true);
    setExportError(null);
    try {
      await exportClientsToPdf(headers, body, new Date());
    } catch {
      setExportError("No fue posible generar el archivo PDF.");
    } finally {
      setIsExporting(false);
    }
  }

  function sortIcon(field: SortField): React.ReactElement {
    const active = sortField === field;
    const arrow = !active ? "<>" : sortDirection === "asc" ? "^" : "v";
    return <span className={`sort-icon${active ? " active" : ""}`}>{arrow}</span>;
  }

  return (
    <>
      <section className="summary-grid">
        <button
          type="button"
          className={`summary-card summary-card--interactive${statusFilter === "active" ? " summary-card--selected" : ""}`}
          onClick={() => setStatusFilter("active")}
        >
          <span>Clientes activos</span>
          <strong>{activeClientsCount}</strong>
        </button>
        <button
          type="button"
          className={`summary-card summary-card--interactive summary-card--inactive${statusFilter === "inactive" ? " summary-card--selected" : ""}`}
          onClick={() => setStatusFilter("inactive")}
        >
          <span>Clientes inactivos</span>
          <strong>{inactiveClientsCount}</strong>
        </button>
      </section>

      {editingClientId !== null && (
        <div className="modal-overlay" onClick={handleCancelEdit}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Editar cliente</h2>
              <button type="button" className="modal-close" onClick={handleCancelEdit}>X</button>
            </div>
            <div className="modal-body">
              <form className="form-grid" onSubmit={handleSubmitClient}>
                <label>UNIDAD/ID
                  <input type="text" value={form.unitId} onChange={(e) => setForm((c) => ({ ...c, unitId: e.target.value }))} placeholder="Ej. APT-101" className={errorFields.has("unitId") ? "input-error" : undefined} required />
                </label>
                <label>Cedula
                  <input type="text" value={form.cedula} onChange={(e) => setForm((c) => ({ ...c, cedula: e.target.value }))} placeholder="Ej. 8-123-456" />
                </label>
                <label>Nombre
                  <input type="text" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Ej. Richard Alexander" className={errorFields.has("name") ? "input-error" : undefined} required />
                </label>
                <label>Fecha primer cobro
                  <input type="date" value={form.firstChargeDate} onChange={(e) => setForm((c) => ({ ...c, firstChargeDate: e.target.value }))} className={errorFields.has("firstChargeDate") ? "input-error" : undefined} required />
                </label>
                <label>Renta (USD)
                  <input type="number" step="0.01" min="0" value={form.rentAmount} onChange={(e) => setForm((c) => ({ ...c, rentAmount: e.target.value }))} placeholder="0.00" className={errorFields.has("rentAmount") ? "input-error" : undefined} required />
                </label>
                <label>Frecuencia
                  <select value={form.frequency} onChange={(e) => setForm((c) => ({ ...c, frequency: e.target.value as BillingFrequency }))}>
                    <option value="daily">Diario</option>
                    <option value="weekly">Semanal</option>
                    <option value="biweekly">Quincenal</option>
                    <option value="monthly">Mensual</option>
                  </select>
                </label>
                {form.frequency === "daily" && (
                  <label>
                    <span style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>Cobrar primer domingo</span>
                    <select value={form.chargeFirstSunday ? "yes" : "no"} onChange={(e) => setForm((c) => ({ ...c, chargeFirstSunday: e.target.value === "yes" }))}>
                      <option value="no">No</option>
                      <option value="yes">Si</option>
                    </select>
                  </label>
                )}
                {form.frequency === "weekly" && (
                  <label>Dia de cobro semanal
                    <select value={form.weeklyChargeDay} onChange={(e) => setForm((c) => ({ ...c, weeklyChargeDay: e.target.value as WeeklyChargeDay }))}>
                      <option value="monday">Lunes</option>
                      <option value="tuesday">Martes</option>
                      <option value="wednesday">Miercoles</option>
                      <option value="thursday">Jueves</option>
                      <option value="friday">Viernes</option>
                      <option value="saturday">Sabado</option>
                    </select>
                  </label>
                )}
                {form.frequency === "monthly" && (
                  <label>Dia del mes para cobrar
                    <input type="number" min="1" max="31" step="1" value={form.monthlyChargeDay} onChange={(e) => setForm((c) => ({ ...c, monthlyChargeDay: e.target.value }))} className={errorFields.has("monthlyChargeDay") ? "input-error" : undefined} required />
                  </label>
                )}
                <label>Cuotas pactadas
                  <input type="number" step="1" min="0" value={form.installmentsAgreed} onChange={(e) => handleInstallmentChange("installmentsAgreed", e.target.value)} className={errorFields.has("installmentsAgreed") ? "input-error" : undefined} required />
                </label>
                <label>Cuotas restantes
                  <input type="number" step="1" min="0" value={form.installmentsRemaining} onChange={(e) => handleInstallmentChange("installmentsRemaining", e.target.value)} className={errorFields.has("installmentsRemaining") ? "input-error" : undefined} required />
                </label>
                <label>Cuotas pagadas
                  <input type="number" step="1" min="0" value={form.installmentsPaid} readOnly />
                </label>
                <label>MONTO A COBRAR (USD)
                  <input type="number" step="0.01" min="0" value={form.initialBalance} onChange={(e) => setForm((c) => ({ ...c, initialBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("initialBalance") ? "input-error" : undefined} required />
                </label>
                <div className="other-charges-section">
                  <div className="other-charges-header">
                    <span>Otros cargos</span>
                    <button type="button" className="button ghost small" onClick={() =>
                      setForm((c) => ({ ...c, otherCharges: [...c.otherCharges, createOtherChargeForm()] }))
                    }>+ Agregar</button>
                  </div>
                  {form.otherCharges.map((charge, i) => (
                    <div key={i} className="other-charge-row">
                      <input type="text" placeholder="Concepto" value={charge.label}
                        onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, label: e.target.value } : ch) }))} />
                      <input type="number" step="0.01" min="0" placeholder="0.00" value={charge.amount}
                        onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, amount: e.target.value } : ch) }))} />
                      <button type="button" className="other-charge-remove" onClick={() =>
                        setForm((c) => ({ ...c, otherCharges: c.otherCharges.filter((_, idx) => idx !== i) }))
                      }>X</button>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  <button type="submit" className={`button primary ${installmentLiveError ? "button-disabled" : ""}`} disabled={installmentLiveError !== null}>
                    Guardar cambios
                  </button>
                  <button type="button" className="button ghost" onClick={handleCancelEdit}>Cancelar</button>
                </div>
              </form>
              {form.frequency === "daily" && <p className="hint">Regla diaria: cobro automatico de lunes a sabado.</p>}
              {form.frequency === "daily" && form.chargeFirstSunday && <p className="hint">Incluye el primer domingo automaticamente una sola vez.</p>}
              {form.frequency === "biweekly" && <p className="hint">Regla quincenal: cobros fijos dia 15 y fin de mes.</p>}
              {form.frequency === "monthly" && <p className="hint">Regla mensual: si el dia configurado cae domingo, el cobro se mueve al lunes siguiente.</p>}
              {errors.length > 0 && <ul className="error-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              {installmentLiveError !== null && <ul className="error-list"><li>{installmentLiveError}</li></ul>}
            </div>
          </div>
        </div>
      )}

      {confirmDialog !== null && (
        <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{confirmDialog.title}</h2>
              <button type="button" className="modal-close" onClick={() => setConfirmDialog(null)}>X</button>
            </div>
            <div className="confirm-modal-body">
              <p>{confirmDialog.message}</p>
              <div className="confirm-modal-actions">
                <button type="button" className={`button ${confirmDialog.variant === "danger" ? "danger" : "primary"}`} onClick={confirmDialog.onConfirm}>Confirmar</button>
                <button type="button" className="button ghost" onClick={() => setConfirmDialog(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pauseDialog !== null && (
        <div className="modal-overlay" onClick={() => setPauseDialog(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Pausar cliente</h2>
              <button type="button" className="modal-close" onClick={() => setPauseDialog(null)}>X</button>
            </div>
            <div className="confirm-modal-body">
              <p>El cliente quedara inactivo y no acumulara cobros hasta que lo reactives. Indica el motivo:</p>
              <textarea
                className="pause-comment-input"
                placeholder="Ej. Acuerdo de pago, reparacion en unidad, negociacion..."
                value={pauseDialog.comment}
                onChange={(e) => setPauseDialog((d) => d ? { ...d, comment: e.target.value } : d)}
                rows={3}
                autoFocus
              />
              <div className="confirm-modal-actions" style={{ marginTop: 16 }}>
                <button type="button" className="button primary" onClick={handleConfirmPause} disabled={pauseDialog.comment.trim().length === 0}>Pausar</button>
                <button type="button" className="button ghost" onClick={() => setPauseDialog(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Nuevo cliente</h2>
          <button type="button" className="button ghost" onClick={() => setIsFormOpen((current) => !current)}>
            {isFormOpen ? "Cerrar" : "+ Nuevo cliente"}
          </button>
        </div>
        {isFormOpen && (
          <form className="form-grid" onSubmit={handleSubmitClient}>
            <label>
              UNIDAD/ID
              <input type="text" value={form.unitId} onChange={(e) => setForm((c) => ({ ...c, unitId: e.target.value }))} placeholder="Ej. APT-101" className={errorFields.has("unitId") ? "input-error" : undefined} required />
            </label>
            <label>
              Cedula
              <input type="text" value={form.cedula} onChange={(e) => setForm((c) => ({ ...c, cedula: e.target.value }))} placeholder="Ej. 8-123-456" />
            </label>
            <label>
              Nombre
              <input type="text" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Ej. Richard Alexander" className={errorFields.has("name") ? "input-error" : undefined} required />
            </label>
            <label>
              Fecha primer cobro
              <input type="date" value={form.firstChargeDate} onChange={(e) => setForm((c) => ({ ...c, firstChargeDate: e.target.value }))} className={errorFields.has("firstChargeDate") ? "input-error" : undefined} required />
            </label>
            <label>
              Renta (USD)
              <input type="number" step="0.01" min="0" value={form.rentAmount} onChange={(e) => setForm((c) => ({ ...c, rentAmount: e.target.value }))} placeholder="0.00" className={errorFields.has("rentAmount") ? "input-error" : undefined} required />
            </label>
            <label>
              Frecuencia
              <select value={form.frequency} onChange={(e) => setForm((c) => ({ ...c, frequency: e.target.value as BillingFrequency }))}>
                <option value="daily">Diario</option>
                <option value="weekly">Semanal</option>
                <option value="biweekly">Quincenal</option>
                <option value="monthly">Mensual</option>
              </select>
            </label>
            {form.frequency === "daily" && (
              <label>
                <span style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>Cobrar primer domingo</span>
                <select value={form.chargeFirstSunday ? "yes" : "no"} onChange={(e) => setForm((c) => ({ ...c, chargeFirstSunday: e.target.value === "yes" }))}>
                  <option value="no">No</option>
                  <option value="yes">Si</option>
                </select>
              </label>
            )}
            {form.frequency === "weekly" && (
              <label>
                Dia de cobro semanal
                <select value={form.weeklyChargeDay} onChange={(e) => setForm((c) => ({ ...c, weeklyChargeDay: e.target.value as WeeklyChargeDay }))}>
                  <option value="monday">Lunes</option>
                  <option value="tuesday">Martes</option>
                  <option value="wednesday">Miercoles</option>
                  <option value="thursday">Jueves</option>
                  <option value="friday">Viernes</option>
                  <option value="saturday">Sabado</option>
                </select>
              </label>
            )}
            {form.frequency === "monthly" && (
              <label>
                Dia del mes para cobrar
                <input type="number" min="1" max="31" step="1" value={form.monthlyChargeDay} onChange={(e) => setForm((c) => ({ ...c, monthlyChargeDay: e.target.value }))} required />
              </label>
            )}
            <label>
              Cuotas pactadas
              <input type="number" step="1" min="0" value={form.installmentsAgreed} onChange={(e) => handleInstallmentChange("installmentsAgreed", e.target.value)} className={errorFields.has("installmentsAgreed") ? "input-error" : undefined} required />
            </label>
            <label>
              Cuotas restantes
              <input type="number" step="1" min="0" value={form.installmentsRemaining} onChange={(e) => handleInstallmentChange("installmentsRemaining", e.target.value)} className={errorFields.has("installmentsRemaining") ? "input-error" : undefined} required />
            </label>
            <label>
              Cuotas pagadas
              <input type="number" step="1" min="0" value={form.installmentsPaid} readOnly />
            </label>
            <label>
              MONTO A COBRAR (USD)
              <input type="number" step="0.01" min="0" value={form.initialBalance} onChange={(e) => setForm((c) => ({ ...c, initialBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("initialBalance") ? "input-error" : undefined} required />
            </label>
            <div className="other-charges-section">
              <div className="other-charges-header">
                <span>Otros cargos</span>
                <button type="button" className="button ghost small" onClick={() =>
                  setForm((c) => ({ ...c, otherCharges: [...c.otherCharges, createOtherChargeForm()] }))
                }>+ Agregar</button>
              </div>
              {form.otherCharges.map((charge, i) => (
                <div key={i} className="other-charge-row">
                  <input type="text" placeholder="Concepto (ej. Mantenimiento)" value={charge.label}
                    onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, label: e.target.value } : ch) }))} />
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={charge.amount}
                    onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, amount: e.target.value } : ch) }))} />
                  <button type="button" className="other-charge-remove" onClick={() =>
                    setForm((c) => ({ ...c, otherCharges: c.otherCharges.filter((_, idx) => idx !== i) }))
                  }>X</button>
                </div>
              ))}
            </div>
            <button type="submit" className={`button primary ${installmentLiveError ? "button-disabled" : ""}`} disabled={installmentLiveError !== null}>
              Guardar cliente
            </button>
          </form>
        )}
        {isFormOpen && (
          <>
            {form.frequency === "daily" && <p className="hint">Regla diaria: cobro automatico de lunes a sabado.</p>}
            {form.frequency === "daily" && form.chargeFirstSunday && <p className="hint">Incluye el primer domingo automaticamente una sola vez.</p>}
            {form.frequency === "biweekly" && <p className="hint">Regla quincenal: cobros fijos dia 15 y fin de mes.</p>}
            {form.frequency === "monthly" && <p className="hint">Regla mensual: si el dia configurado cae domingo, el cobro se mueve al lunes siguiente.</p>}
            {errors.length > 0 && <ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
            {installmentLiveError !== null && <ul className="error-list"><li>{installmentLiveError}</li></ul>}
          </>
        )}
      </section>

      <section className="panel">
        <h2>Clientes</h2>
        <div className="filters-bar">
          <input type="text" placeholder="Buscar por unidad, cliente o cedula" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <select value={frequencyFilter} onChange={(e) => setFrequencyFilter(e.target.value as "all" | BillingFrequency)}>
            <option value="all">Todas las frecuencias</option>
            <option value="daily">Diario</option>
            <option value="weekly">Semanal</option>
            <option value="biweekly">Quincenal</option>
            <option value="monthly">Mensual</option>
          </select>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="all">Todos los grupos</option>
            {availableGroups.map((group) => (
              <option key={group} value={group}>Grupo {group}</option>
            ))}
          </select>
          <select value={debtFilter} onChange={(e) => setDebtFilter(e.target.value as "all" | "withDebt" | "withoutDebt")}>
            <option value="all">Con y sin deuda</option>
            <option value="withDebt">Solo con deuda</option>
            <option value="withoutDebt">Solo al dia</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="active">Solo activos</option>
            <option value="inactive">Solo inactivos</option>
            <option value="archived">Solo archivados</option>
            <option value="all">Activos y archivados</option>
          </select>
        </div>
        <div className="export-bar">
          <button type="button" className="button ghost small" onClick={() => setIsExportOpen((v) => !v)}>
            {isExportOpen ? "Cerrar exportacion" : "Exportar"}
          </button>
        </div>

        {isExportOpen && (
          <div className="export-panel">
            <p className="export-title">Selecciona las columnas a exportar:</p>
            <div className="export-fields">
              {exportFields.map((field) => (
                <label key={field.key} className="export-field-label">
                  <input type="checkbox" checked={field.enabled} onChange={() =>
                    setExportFields((current) => current.map((f) => f.key === field.key ? { ...f, enabled: !f.enabled } : f))
                  } />
                  {field.label}
                </label>
              ))}
            </div>
            <div className="export-actions">
              <button type="button" className="button primary" onClick={handleExportExcel} disabled={isExporting}>
                {isExporting ? "Exportando..." : "Descargar Excel"}
              </button>
              <button type="button" className="button ghost" onClick={handleExportPDF} disabled={isExporting}>
                Descargar PDF
              </button>
            </div>
            {exportError !== null && <p className="hint error-text">{exportError}</p>}
            <p className="hint">Se exportan los {rows.length} clientes visibles con los filtros actuales.</p>
          </div>
        )}

        <p className="hint">Mostrando {rows.length} de {clients.length} clientes.</p>

        {rows.length === 0 ? (
          <p className="empty">Aun no hay clientes con ese filtro.</p>
        ) : (
          <>
            <div className="top-scroll" ref={topScrollRef} onScroll={handleTopScroll}>
              <div ref={topScrollInnerRef} style={{ height: 1 }} />
            </div>
            <div className="table-scroll" ref={tableScrollRef} onScroll={handleTableScroll}>
              <table>
                <thead>
                  <tr>
                    <th><button type="button" className="sort-button" onClick={() => handleSort("unitId")}>UNIDAD/ID {sortIcon("unitId")}</button></th>
                    <th><button type="button" className="sort-button" onClick={() => handleSort("name")}>Cliente {sortIcon("name")}</button></th>
                    <th>Cedula</th>
                    <th><button type="button" className="sort-button" onClick={() => handleSort("rentAmount")}>Renta {sortIcon("rentAmount")}</button></th>
                    <th><button type="button" className="sort-button" onClick={() => handleSort("frequency")}>Frecuencia {sortIcon("frequency")}</button></th>
                    <th>Cuotas pactadas</th>
                    <th>Cuotas restantes</th>
                    <th>Cuotas pagadas</th>
                    <th>Otros cargos</th>
                    <th><button type="button" className="sort-button" onClick={() => handleSort("balance")}>MONTO A COBRAR {sortIcon("balance")}</button></th>
                    <th>AHORRO DE SINIESTROS</th>
                    <th><button type="button" className="sort-button" onClick={() => handleSort("debtDate")}>DEBE DESDE {sortIcon("debtDate")}</button></th>
                    <th><button type="button" className="sort-button" onClick={() => handleSort("status")}>Estado {sortIcon("status")}</button></th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ client, debtStartDate, nextChargeDate, pendingInstallments }) => {
                    const otherChargeText = client.otherCharges.length > 0
                      ? client.otherCharges.map((c) => `${c.label}: ${formatCurrency(c.amount)}`).join(" | ")
                      : null;

                    return (
                      <tr key={client.id}>
                        <td><strong>{client.unitId}</strong></td>
                        <td>
                          <span className="client-name">
                            {client.name}{client.archivedAt ? " (Archivado)" : ""}
                          </span>
                        </td>
                        <td><span className="amount-muted">{client.cedula ?? "-"}</span></td>
                        <td>{formatCurrency(client.rentAmount)}</td>
                        <td>
                          {client.frequency === "daily"
                            ? (
                              <>
                                {FREQUENCY_LABEL[client.frequency]}
                                <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>
                                  1er domingo: {client.chargeFirstSunday ? "Si" : "No"}
                                </div>
                              </>
                            )
                            : FREQUENCY_LABEL[client.frequency]}
                        </td>
                        <td>{client.installmentsAgreed}</td>
                        <td>{client.installmentsRemaining}</td>
                        <td>{client.installmentsPaid}</td>
                        <td>
                          {otherChargeText
                            ? <span className="badge badge-warning">{otherChargeText}</span>
                            : <span className="amount-muted">-</span>}
                        </td>
                        <td>
                          <span className={client.balance <= 0 ? "amount-good" : "amount-debt"}>
                            {formatCurrency(client.balance)}
                          </span>
                        </td>
                        <td>
                          <span className={client.savings > 0 ? "amount-good" : "amount-muted"}>
                            {formatCurrency(client.savings)}
                          </span>
                        </td>
                        <td>
                          {debtStartDate ? (
                            <span className="badge badge-debt">
                              {formatDate(debtStartDate)}
                              <span className="debt-meta">{pendingInstallments} {pendingInstallments === 1 ? "cuota" : "cuotas"}</span>
                            </span>
                          ) : nextChargeDate ? (
                            <span className="badge badge-good">Al dia - {formatDate(nextChargeDate)}</span>
                          ) : (
                            <span className="badge badge-good">Al dia</span>
                          )}
                        </td>
                        <td className="status-cell">
                          {!client.archivedAt && (
                            <button
                              type="button"
                              className={`status-badge ${client.status === "inactive" ? "status-badge--inactive" : "status-badge--active"}`}
                              title={client.status === "inactive" && client.statusComment ? `Motivo: ${client.statusComment}` : undefined}
                              onClick={() => handleToggleStatus(client)}
                            >
                              {client.status === "inactive" ? "Inactivo" : "Activo"}
                            </button>
                          )}
                        </td>
                        <td className="actions-cell">
                          <button type="button" className="action-btn action-btn--edit" title="Editar" onClick={() => handleStartEditClient(client)}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          {client.archivedAt ? (
                            <button type="button" className="action-btn action-btn--restore" title="Restaurar" onClick={() => handleRestoreClient(client.id)}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.87"/></svg>
                            </button>
                          ) : (
                            <button type="button" className="action-btn action-btn--archive" title="Archivar" onClick={() => handleArchiveClient(client.id)}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                            </button>
                          )}
                          <button type="button" className="action-btn action-btn--delete" title="Eliminar" onClick={() => handleDeleteClient(client.id)}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
