import { useEffect, useMemo, useState } from "react";
import {
  getBusinessDateKey,
  parseDateKey,
  startOfDay
} from "../billing";
import { exportClientsToExcel, exportClientsToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import { loadControlUnits, setControlUnitStatus } from "../cloudData";
import { supabase } from "../lib/supabase";
import type { Client } from "../types";
import {
  ClientInfoDialog,
  ConfirmDialog,
  StatusChangeDialog,
  VehicleInfoDialog,
  type ConfirmDialogValue,
  type FleetDetail,
  type StatusDialogValue
} from "./clients/ClientsDialogs";
import { CreateClientDialog, EditClientDialog } from "./clients/ClientFormDialogs";
import { ClientsDirectoryPanel } from "./clients/ClientsDirectoryPanel";
import { useClientDirectoryFilters, useClientDirectoryRows } from "./clients/useClientDirectory";

import { FREQUENCY_LABEL, INITIAL_EXPORT_FIELDS, initialForm } from "./clients/clientConstants";
import type {
  ClientForm,
  ClientsViewTab,
  EditClientTab,
  ExportField,
  ExportFieldKey,
  PlanFilterKey
} from "./clients/clientTypes";
import {
  buildClient,
  createOtherChargeForm,
  getOperationalReferenceDate,
  parseIntegerOrNull,
  parseNumberOrNull
} from "./clients/clientRules";

type Props = {
  clients: Client[];
  onClientsChange: (next: Client[]) => void | Promise<void>;
  onClientsRefresh?: () => void | Promise<void>;
  dataOwnerUserId?: string | null;
  readOnly?: boolean;
};

export default function ClientsPage({ clients, onClientsChange, onClientsRefresh, dataOwnerUserId, readOnly = false }: Props) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [form, setForm] = useState<ClientForm>(initialForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [errorFields, setErrorFields] = useState<Set<string>>(new Set());
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(!readOnly && clients.length === 0);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogValue | null>(null);
  const [statusDialog, setStatusDialog] = useState<StatusDialogValue | null>(null);
  const [editClientTab, setEditClientTab] = useState<EditClientTab>("identidad");
  const [clientsViewTab, setClientsViewTab] = useState<ClientsViewTab>("current");
  const [fleetUnitOptions, setFleetUnitOptions] = useState<string[]>([]);
  const [fleetDetailsByUnit, setFleetDetailsByUnit] = useState<Record<string, FleetDetail>>({});
  const [vehicleInfoUnit, setVehicleInfoUnit] = useState<string | null>(null);
  const [clientInfoId, setClientInfoId] = useState<string | null>(null);
  const operationalReferenceDate = useMemo(() => getOperationalReferenceDate(now), [now]);
  const occupiedUnitSet = useMemo(() => {
    const set = new Set<string>();
    for (const client of clients) {
      if (client.status === "archivado") continue;
      const unit = client.unitId.trim().toUpperCase();
      if (unit) set.add(unit);
    }
    return set;
  }, [clients]);
  const availableUnitOptions = useMemo(() => {
    const currentEditingUnit = editingClientId
      ? (clients.find((client) => client.id === editingClientId)?.unitId.trim().toUpperCase() ?? "")
      : "";
    return fleetUnitOptions.filter((unit) => !occupiedUnitSet.has(unit) || unit === currentEditingUnit);
  }, [clients, editingClientId, fleetUnitOptions, occupiedUnitSet]);
  const { rows, legacyClients: clients20Rows } = useClientDirectoryRows(
    clients,
    fleetUnitOptions,
    operationalReferenceDate
  );
  const {
    displayedRows,
    generalGroupFilter,
    setGeneralGroupFilter,
    planFilter,
    setPlanFilter,
    weeklyChargeDayFilter,
    setWeeklyChargeDayFilter,
    unitSearchFilter,
    setUnitSearchFilter,
    clientNameSearchFilter,
    setClientNameSearchFilter
  } = useClientDirectoryFilters({ rows });
  async function persist(next: Client[]): Promise<void> {
    if (readOnly) return;
    await onClientsChange(next);
  }

  function roundInlineMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function updateClientInline(clientId: string, updater: (client: Client) => Client): void {
    if (readOnly) return;
    const nextClients = clients.map((client) => client.id === clientId ? updater(client) : client);
    setErrors([]);
    void persist(nextClients).catch((error) => {
      console.error("No se pudo guardar edicion rapida de cliente.", error);
      setErrors([describeCloudSaveError("No se pudo guardar la edicion rapida.", error)]);
    });
  }

  function handleInlineBalanceChange(client: Client, rawValue: string): void {
    if (readOnly) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    updateClientInline(client.id, (current) => ({
      ...current,
      balance: roundInlineMoney(value)
    }));
  }

  function handleInlineInstallmentsChange(client: Client, field: "paid" | "agreed", rawValue: string): void {
    if (readOnly) return;
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0) return;
    updateClientInline(client.id, (current) => {
      const installmentsAgreed = field === "agreed" ? value : current.installmentsAgreed;
      const installmentsPaid = Math.min(field === "paid" ? value : current.installmentsPaid, installmentsAgreed);
      return {
        ...current,
        installmentsAgreed,
        installmentsPaid,
        installmentsRemaining: Math.max(0, installmentsAgreed - installmentsPaid)
      };
    });
  }

  function handleInlineOtherChargesChange(client: Client, rawLabel: string, rawValue: string): void {
    if (readOnly) return;
    const label = rawLabel.trim();
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    const amount = roundInlineMoney(value);
    if (amount > 0 && !label) {
      setErrors(["Para guardar otros cargos debes indicar el concepto."]);
      return;
    }
    setErrors([]);
    updateClientInline(client.id, (current) => ({
      ...current,
      otherCharges: amount > 0
        ? [{ id: current.otherCharges[0]?.id ?? crypto.randomUUID(), label, amount }]
        : []
    }));
  }

  function describeCloudSaveError(baseMessage: string, error: unknown): string {
    const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
    const code = typeof record?.code === "string" ? record.code : "";
    const message = error instanceof Error
      ? error.message
      : typeof record?.message === "string"
      ? record.message
      : "";
    const details = typeof record?.details === "string" ? record.details : "";
    const hint = typeof record?.hint === "string" ? record.hint : "";
    const normalized = `${code} ${message} ${details} ${hint}`.toLowerCase();

    if (normalized.includes("row-level security") || normalized.includes("permission denied") || code === "42501") {
      return `${baseMessage} Motivo exacto: permisos insuficientes en Supabase (RLS/owner).`;
    }
    if (normalized.includes("jwt") || normalized.includes("token") || normalized.includes("not authenticated") || code === "PGRST303") {
      return `${baseMessage} Motivo exacto: sesion expirada o no autenticada.`;
    }
    if (normalized.includes("network") || normalized.includes("fetch") || normalized.includes("timeout")) {
      return `${baseMessage} Motivo exacto: problema de conexion/red.`;
    }

    const raw = [code, message, details, hint]
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(" | ");
    return raw ? `${baseMessage} Motivo exacto: ${raw.slice(0, 220)}` : baseMessage;
  }

  async function wasClientSavedInCloud(client: Client): Promise<boolean> {
    if (!dataOwnerUserId || !supabase) return false;
    const { data, error } = await supabase
      .from("clients_cloud")
      .select("data")
      .eq("user_id", dataOwnerUserId)
      .eq("id", client.id)
      .maybeSingle();
    if (error) {
      console.error("No se pudo verificar si el cliente quedo guardado en nube.", error);
      return false;
    }
    const saved = (data as { data?: Partial<Client> } | null)?.data;
    return (
      saved?.id === client.id &&
      saved?.unitId === client.unitId &&
      saved?.name === client.name
    );
  }

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setFleetUnitOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadControlUnits(dataOwnerUserId);
        if (cancelled) return;
        const units = Array.from(
          new Set(
            data
              .map((row) => String(row.unit_id ?? "").trim().toUpperCase())
              .filter((unit) => unit.length > 0)
          )
        ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        setFleetUnitOptions(units);
        const nextDetails: Record<string, {
          plate?: string | null;
          brand_model?: string | null;
          engine_serial?: string | null;
          chassis_serial?: string | null;
          cupo?: string | null;
          company?: string | null;
          observation?: string | null;
        }> = {};
        for (const row of data) {
          const key = String(row.unit_id ?? "").trim().toUpperCase();
          if (!key) continue;
          nextDetails[key] = {
            plate: row.plate ?? null,
            brand_model: row.brand_model ?? null,
            engine_serial: row.engine_serial ?? null,
            chassis_serial: row.chassis_serial ?? null,
            cupo: row.cupo ?? null,
            company: row.company ?? null,
            observation: row.observation ?? null
          };
        }
        setFleetDetailsByUnit(nextDetails);
      } catch (error) {
        console.error("No se pudo cargar nomenclatura de flota para Clientes.", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

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
    const normalizedUnit = input.unitId.trim().toUpperCase();
    const duplicated = clients.some(
      (client) =>
        client.id !== currentEditingId &&
        client.status !== "archivado" &&
        client.unitId.trim().toUpperCase() === normalizedUnit
    );
    if (duplicated) { messages.push("UNIDAD/ID ya existe en clientes activos. No se permiten duplicados activos."); fields.add("unitId"); }
    if (fleetUnitOptions.length > 0 && !fleetUnitOptions.includes(normalizedUnit)) {
      messages.push("UNIDAD/ID no existe en la base de flota. Usa una nomenclatura valida.");
      fields.add("unitId");
    }
    const occupiedByOther = clients.some((client) => (
      client.id !== currentEditingId &&
      client.status !== "archivado" &&
      client.unitId.trim().toUpperCase() === normalizedUnit
    ));
    if (occupiedByOther) {
      messages.push("UNIDAD/ID ya esta ocupada por otro cliente activo.");
      fields.add("unitId");
    }
    if (!input.name.trim()) { messages.push("El nombre del cliente es obligatorio."); fields.add("name"); }
    const firstChargeDate = parseDateKey(input.firstChargeDate.trim());
    if (!firstChargeDate) {
      messages.push("La fecha de primer cobro es obligatoria.");
      fields.add("firstChargeDate");
    } else {
      const today = parseDateKey(getBusinessDateKey()) ?? startOfDay(new Date());
      if (currentEditingId === null && startOfDay(firstChargeDate) < today) {
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
    const travelFundBalance = Number(input.travelFundBalance);
    if (!Number.isFinite(travelFundBalance) || travelFundBalance < 0) {
      messages.push("El FONDO DE VIAJE debe ser un numero valido mayor o igual a 0.");
      fields.add("travelFundBalance");
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

  async function handleSubmitClient(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedForm = recalculateInstallments({ ...form, unitId: form.unitId.trim().toUpperCase() });
    setForm(normalizedForm);

    const { messages: nextErrors, fields: nextFields } = validate(normalizedForm, editingClientId);
    setErrors(nextErrors);
    setErrorFields(nextFields);
    if (nextErrors.length > 0) return;

    if (editingClientId !== null) {
      const existing = clients.find((client) => client.id === editingClientId);
      if (!existing) { setErrors(["No se encontro el cliente a editar."]); return; }
      const nextClient = buildClient(normalizedForm, existing);
      try {
        await persist(clients.map((client) => client.id === editingClientId ? nextClient : client));
      } catch (error) {
        console.error("No se pudo guardar el cliente en la nube.", error);
        if (!(await wasClientSavedInCloud(nextClient))) {
          setErrors([describeCloudSaveError("No se pudo guardar el cliente en la nube.", error)]);
          return;
        }
      }
    } else {
      const nextClient = buildClient(normalizedForm);
      try {
        await persist([...clients, nextClient]);
      } catch (error) {
        console.error("No se pudo crear el cliente en la nube.", error);
        if (!(await wasClientSavedInCloud(nextClient))) {
          setErrors([describeCloudSaveError("No se pudo crear el cliente en la nube.", error)]);
          return;
        }
      }
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
      firstChargeDate: client.firstChargeDate ?? getBusinessDateKey(),
      rentAmount: String(client.rentAmount),
      frequency: client.frequency,
      chargeFirstSunday: client.chargeFirstSunday ?? false,
      initialBalance: String(client.balance),
      travelFundBalance: String(client.travelFundBalance ?? 0),
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
    setEditClientTab("identidad");
  }

  function handleCancelEdit(): void {
    setEditingClientId(null);
    setEditClientTab("identidad");
    setForm(initialForm);
    setErrors([]);
    setErrorFields(new Set());
    setIsFormOpen(false);
  }

  function handleOpenNewClient(): void {
    setEditingClientId(null);
    setEditClientTab("identidad");
    setForm(initialForm);
    setErrors([]);
    setErrorFields(new Set());
    setIsFormOpen(true);
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
        lastChargeDate: getBusinessDateKey()
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

  function handleStatusSelection(client: Client, nextStatus: Client["status"]): void {
    if (!isStatusAllowedForClient(client, nextStatus)) {
      setErrors(["'Cliente Enfermo' solo aplica para clientes de plan diario."]);
      return;
    }
    if (nextStatus === client.status) return;

    const needsComment = requiresComment(nextStatus);
    if (!needsComment) {
      void persist(clients.map((c) => (c.id === client.id ? applyClientStatusChange(c, nextStatus, "") : c))).catch(() => {
        setErrors(["No se pudo guardar el cambio de estado en la nube. Intenta de nuevo."]);
      });
      return;
    }
    setStatusDialog({ clientId: client.id, nextStatus, comment: "" });
  }

  async function handleConfirmStatusChange(): Promise<void> {
    if (!statusDialog) return;
    const comment = statusDialog.comment.trim();
    if (requiresComment(statusDialog.nextStatus) && !comment) return;
    try {
      await persist(clients.map((c) =>
        c.id === statusDialog.clientId ? applyClientStatusChange(c, statusDialog.nextStatus, comment) : c
      ));
    } catch {
      setErrors(["No se pudo guardar el cambio de estado en la nube. Intenta de nuevo."]);
      return;
    }
    setStatusDialog(null);
  }

  function handleCreateClientFromUnit(unitId: string): void {
    setEditingClientId(null);
    setErrors([]);
    setErrorFields(new Set());
    setForm({ ...initialForm, unitId });
    setIsFormOpen(true);
  }

  function handlePlanFilterChange(filter: PlanFilterKey): void {
    setPlanFilter(filter);
    if (filter !== "weekly") setWeeklyChargeDayFilter("ALL");
  }

  function handleUnlinkClient(client: Client): void {
    setConfirmDialog({
      title: "Desvincular cliente",
      message: `Se desvinculara ${client.name} de la unidad ${client.unitId}. La unidad quedara libre y el cliente pasara a Clientes archivados. ¿Deseas continuar?`,
      variant: "warning",
      onConfirm: async () => {
        const nowIso = new Date().toISOString();
        const unitId = client.unitId.trim().toUpperCase();
        const nextClient: Client = {
          ...client,
          status: "archivado",
          statusComment: `Desvinculado de unidad ${client.unitId} el ${new Date().toLocaleDateString("es-PA")}`,
          archivedAt: nowIso
        };
        try {
          if (dataOwnerUserId && supabase) {
            if (unitId) {
              await setControlUnitStatus(dataOwnerUserId, unitId, "libre");
            }
            const { error: clientError } = await supabase
              .from("clients_cloud")
              .upsert({
                user_id: dataOwnerUserId,
                id: client.id,
                data: nextClient,
                updated_at: nowIso
              }, { onConflict: "user_id,id" });
            if (clientError) throw clientError;
          }

          if (onClientsRefresh) {
            await onClientsRefresh();
          } else {
            await persist(clients.map((current) => current.id === client.id ? nextClient : current));
          }
        } catch (error) {
          console.error("No se pudo desvincular el cliente.", error);
          setErrors([describeCloudSaveError("No se pudo desvincular el cliente en la nube. La unidad no fue liberada.", error)]);
          setConfirmDialog(null);
          return;
        }
        setConfirmDialog(null);
      }
    });
  }

  type RowData = typeof rows[number];

  function getExportCell(key: ExportFieldKey, row: RowData): string | number {
    const { client, debtStartDate, nextChargeDate } = row;
    if (!client) return "-";
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
        if (nextChargeDate) return `Al día hasta ${formatDate(nextChargeDate)}`;
        return "Al dia";
    }
  }

  function buildExportData(): { headers: string[]; body: (string | number)[][] } {
    const active = exportFields.filter((f) => f.enabled);
    const headers = active.map((f) => f.label);
    const body = displayedRows
      .filter((row) => row.client !== null)
      .map((row) => active.map((f) => getExportCell(f.key, row)));
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

  return (
    <div className="clients-luxury-page">
      <EditClientDialog
        editingClientId={editingClientId}
        onCancel={handleCancelEdit}
        form={form}
        setForm={setForm}
        editClientTab={editClientTab}
        setEditClientTab={setEditClientTab}
        availableUnitOptions={availableUnitOptions}
        errorFields={errorFields}
        onSubmit={handleSubmitClient}
        onInstallmentChange={handleInstallmentChange}
        installmentLiveError={installmentLiveError}
        errors={errors}
      />

      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
      <StatusChangeDialog dialog={statusDialog} setDialog={setStatusDialog} onConfirm={handleConfirmStatusChange} />
      <VehicleInfoDialog unitId={vehicleInfoUnit} detailsByUnit={fleetDetailsByUnit} onClose={() => setVehicleInfoUnit(null)} />
      <ClientInfoDialog clientId={clientInfoId} clients={clients} onClose={() => setClientInfoId(null)} />

      <CreateClientDialog
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        form={form}
        setForm={setForm}
        availableUnitOptions={availableUnitOptions}
        errorFields={errorFields}
        onSubmit={handleSubmitClient}
        onInstallmentChange={handleInstallmentChange}
        installmentLiveError={installmentLiveError}
        errors={errors}
      />

      <ClientsDirectoryPanel
        rows={displayedRows}
        legacyClients={clients20Rows}
        fleetDetailsByUnit={fleetDetailsByUnit}
        viewTab={clientsViewTab}
        onViewTabChange={setClientsViewTab}
        isExportOpen={isExportOpen}
        exportFields={exportFields}
        isExporting={isExporting}
        exportError={exportError}
        exportRowCount={displayedRows.length}
        onToggleExport={() => setIsExportOpen((open) => !open)}
        onToggleExportField={(key) =>
          setExportFields((current) =>
            current.map((field) => field.key === key ? { ...field, enabled: !field.enabled } : field)
          )
        }
        onExportExcel={() => void handleExportExcel()}
        onExportPdf={() => void handleExportPDF()}
        groupFilter={generalGroupFilter}
        planFilter={planFilter}
        weeklyChargeDayFilter={weeklyChargeDayFilter}
        unitSearch={unitSearchFilter}
        clientSearch={clientNameSearchFilter}
        onGroupFilterChange={setGeneralGroupFilter}
        onPlanFilterChange={handlePlanFilterChange}
        onWeeklyChargeDayFilterChange={setWeeklyChargeDayFilter}
        onUnitSearchChange={setUnitSearchFilter}
        onClientSearchChange={setClientNameSearchFilter}
        onClearSearch={() => {
          setPlanFilter("ALL");
          setWeeklyChargeDayFilter("ALL");
          setUnitSearchFilter("");
          setClientNameSearchFilter("");
        }}
        onOpenNewClient={handleOpenNewClient}
        onBalanceChange={handleInlineBalanceChange}
        onInstallmentsChange={handleInlineInstallmentsChange}
        onOtherChargesChange={handleInlineOtherChargesChange}
        onStatusChange={handleStatusSelection}
        onShowVehicle={setVehicleInfoUnit}
        onShowClient={setClientInfoId}
        onEditClient={(client) => {
          handleStartEditClient(client);
          setEditClientTab("identidad");
        }}
        onUnlinkClient={handleUnlinkClient}
        onCreateClientFromUnit={handleCreateClientFromUnit}
        readOnly={readOnly}
      />

    </div>
  );
}
