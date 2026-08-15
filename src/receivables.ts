import { findNextChargeDay, getDebtStartDate, isChargeDay, parseDateKey, startOfDay, toDateKey } from "./billing";
import type { ControlUnitRow } from "./cloudData";
import type { BillingFrequency, Client, Payment, WeeklyChargeDay } from "./types";
import { getCollectibleProvisionalRental, nextProvisionalRentalChargeDate } from "./provisionalRentals";

export type ReceivableState = "alDia" | "proximo" | "venceHoy" | "vencido" | "critico";
export type ReceivableStateFilter = "all" | ReceivableState;
export type ReceivableSortField =
  | "unitId"
  | "name"
  | "group"
  | "plan"
  | "nextDueDate"
  | "daysLate"
  | "overdueBalance"
  | "totalPending"
  | "installmentsRemaining"
  | "rentAmount"
  | "lastPaymentDate"
  | "percentPaid"
  | "state";
export type SortDirection = "asc" | "desc";

export type ReceivableFilters = {
  clientSearch: string;
  unitSearch: string;
  cedulaSearch: string;
  state: ReceivableState[];
  group: "all" | string;
  plan: "all" | BillingFrequency;
  dateFrom: string;
  dateTo: string;
};

export type ReceivablePaymentSnapshot = {
  id: string;
  dateApplied: string;
  createdAt?: string;
  amountReceived: number;
  appliedToRent: number;
};

export type ReceivableRow = {
  id: string;
  unitId: string;
  name: string;
  cedula: string;
  whatsAppPhone?: string;
  group: string;
  plan: BillingFrequency;
  weeklyChargeDay?: WeeklyChargeDay;
  chargeFirstSunday?: boolean;
  monthlyChargeDay?: number;
  nextDueDate: string | null;
  daysLate: number;
  overdueInstallments: number;
  overdueBalance: number;
  totalPending: number;
  lastPaymentDate: string | null;
  lastPaymentAt?: string | null;
  lastPaymentAmount: number;
  percentPaid: number;
  installmentsAgreed: number;
  installmentsPaid: number;
  installmentsRemaining: number;
  rentAmount: number;
  contractTotal: number;
  totalPaid: number;
  state: ReceivableState;
  totalOtherCharges: number;
  recentPayments: ReceivablePaymentSnapshot[];
  hasActiveClient: boolean;
  operationalStatus?: string;
};

export type ReceivableSummary = {
  totalPorCobrar: number;
  totalVencido: number;
  proximoAVencer: number;
  clientesMorosos: number;
  cobradoEsteMes: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const PLAN_LABEL: Record<BillingFrequency, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual"
};

export const WEEKDAY_LABEL: Record<WeeklyChargeDay, string> = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miercoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sabado"
};

export const STATE_LABEL: Record<ReceivableState, string> = {
  alDia: "Al dia",
  proximo: "Proximo a vencer",
  venceHoy: "Vence hoy",
  vencido: "Vencido",
  critico: "Moroso critico"
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeInstallmentsPercent(installmentsAgreed: number, installmentsPaid: number): number {
  const agreed = Math.max(0, Math.floor(installmentsAgreed));
  const paid = Math.max(0, Math.floor(installmentsPaid));
  if (agreed <= 0) return 0;
  return Math.round(clamp((paid / agreed) * 100, 0, 100));
}

function daysBetween(from: Date, to: Date): number {
  const start = startOfDay(from);
  const end = startOfDay(to);
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function sumOtherCharges(client: Client): number {
  return roundMoney((client.otherCharges ?? []).reduce((sum, charge) => sum + Math.max(0, charge.amount), 0));
}

export function getGroupFromUnit(unitId: string): string {
  const prefix = unitId.trim().match(/^([A-Za-z]+)/)?.[1] ?? "";
  return prefix.toUpperCase().slice(0, 1);
}

export function computeReceivableState(balance: number, daysLate: number, daysUntilDue: number | null): ReceivableState {
  if (balance <= 0) return "alDia";
  if (daysLate > 15) return "critico";
  if (daysLate >= 1) return "vencido";
  if (daysLate === 0) return "venceHoy";
  if (daysUntilDue !== null && daysUntilDue >= 1 && daysUntilDue <= 3) return "proximo";
  return "alDia";
}

function computeOverdueInstallments(client: Client, debtStartDate: Date | null, referenceDate: Date): number {
  if (!debtStartDate || client.balance <= 0) return 0;
  const strictReference = new Date(referenceDate);
  strictReference.setDate(strictReference.getDate() - 1);
  if (strictReference < startOfDay(debtStartDate)) return 0;
  let installments = 0;
  for (let cursor = startOfDay(debtStartDate); cursor <= strictReference; cursor = new Date(cursor.getTime() + DAY_MS)) {
    if (isChargeDay(client, cursor)) installments += 1;
  }
  return Math.max(0, installments);
}

function parsePaymentDate(dateKey: string): number {
  return parseDateKey(dateKey)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function normalizeIdentityText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeUnit(value: string | undefined): string {
  return normalizeIdentityText(value).replace(/[^a-z0-9]/g, "");
}

function parseUnitSortParts(unitId: string): { group: string; number: number; suffix: string } {
  const normalized = unitId.trim().toUpperCase();
  const match = normalized.match(/^([A-Z]+)\D*0*(\d+)(.*)$/);
  if (!match) return { group: normalized, number: Number.POSITIVE_INFINITY, suffix: "" };
  return {
    group: match[1] ?? normalized,
    number: Number(match[2] ?? Number.POSITIVE_INFINITY),
    suffix: match[3] ?? ""
  };
}

export function compareUnitIds(left: string, right: string): number {
  const a = parseUnitSortParts(left);
  const b = parseUnitSortParts(right);
  const group = a.group.localeCompare(b.group, "es", { sensitivity: "base" });
  if (group !== 0) return group;
  if (a.number !== b.number) return a.number - b.number;
  const suffix = a.suffix.localeCompare(b.suffix, "es", { sensitivity: "base", numeric: true });
  if (suffix !== 0) return suffix;
  return left.localeCompare(right, "es", { sensitivity: "base", numeric: true });
}

function normalizeCedula(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function paymentMatchesClientIdentity(payment: Payment, client: Client): boolean {
  const clientCedula = normalizeCedula(client.cedula);
  const paymentCedula = normalizeCedula(payment.clientCedula);
  if (clientCedula && paymentCedula && clientCedula === paymentCedula) return true;

  const clientName = normalizeIdentityText(client.name);
  const paymentName = normalizeIdentityText(payment.clientName);
  return !!clientName && clientName === paymentName;
}

function mergePaymentLists(...lists: Payment[][]): Payment[] {
  const byId = new Map<string, Payment>();
  for (const list of lists) {
    for (const payment of list) byId.set(payment.id, payment);
  }
  return [...byId.values()].sort((a, b) => parsePaymentDate(b.dateApplied) - parsePaymentDate(a.dateApplied));
}

export function buildReceivableRows(clients: Client[], payments: Payment[], now: Date, fleetUnits: ControlUnitRow[] = []): ReceivableRow[] {
  const referenceDate = startOfDay(now);
  const paymentsByClient = new Map<string, Payment[]>();
  const paymentsByUnit = new Map<string, Payment[]>();
  const activeClients = clients.filter((client) => !client.archivedAt);
  const activeClientByUnit = new Map<string, Client>();
  for (const client of activeClients) {
    const normalizedUnit = normalizeUnit(client.activeProvisionalRental?.unitId ?? client.unitId);
    if (normalizedUnit && !activeClientByUnit.has(normalizedUnit)) activeClientByUnit.set(normalizedUnit, client);
  }

  for (const payment of payments) {
    const list = paymentsByClient.get(payment.clientId) ?? [];
    list.push(payment);
    paymentsByClient.set(payment.clientId, list);

    const normalizedUnit = normalizeUnit(payment.clientUnit);
    if (normalizedUnit) {
      const unitList = paymentsByUnit.get(normalizedUnit) ?? [];
      unitList.push(payment);
      paymentsByUnit.set(normalizedUnit, unitList);
    }
  }

  for (const list of paymentsByClient.values()) {
    list.sort((a, b) => parsePaymentDate(b.dateApplied) - parsePaymentDate(a.dateApplied));
  }

  function rowFromClient(client: Client, operationalStatus: string = client.status): ReceivableRow {
      const provisionalRental = getCollectibleProvisionalRental(client);
      const effectiveUnitId = client.activeProvisionalRental?.unitId ?? client.unitId;
      const effectiveBalance = provisionalRental?.balance ?? client.balance;
      const effectiveRentAmount = provisionalRental?.rentAmount ?? client.rentAmount;
      const effectiveFrequency = provisionalRental?.frequency ?? client.frequency;
      const oldestRentalDebtKey = provisionalRental?.charges
        .filter((charge) => charge.amountPaid < charge.amount)
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0]?.dueDate;
      const debtStartDate = provisionalRental
        ? (oldestRentalDebtKey ? parseDateKey(oldestRentalDebtKey) : null)
        : getDebtStartDate(client, referenceDate);
      const regularNextChargeDate = provisionalRental ? null : (debtStartDate ?? findNextChargeDay(client, referenceDate));
      const nextDueDate = provisionalRental
        ? (oldestRentalDebtKey ?? nextProvisionalRentalChargeDate(provisionalRental))
        : regularNextChargeDate ? toDateKey(regularNextChargeDate) : null;
      const daysLate = debtStartDate ? Math.max(0, daysBetween(debtStartDate, referenceDate)) : -1;
      const daysUntilDue = debtStartDate
        ? -daysLate
        : nextDueDate && parseDateKey(nextDueDate)
        ? daysBetween(referenceDate, parseDateKey(nextDueDate)!)
        : null;
      const state = computeReceivableState(effectiveBalance, daysLate, daysUntilDue);
      const overdueInstallments = provisionalRental
        ? provisionalRental.charges.filter((charge) => charge.amountPaid < charge.amount).length
        : computeOverdueInstallments(client, debtStartDate, referenceDate);
      const overdueBalance = debtStartDate && effectiveBalance > 0
        ? roundMoney(Math.max(0, effectiveBalance))
        : 0;

      const directPayments = paymentsByClient.get(client.id) ?? [];
      const identityUnitPayments = (paymentsByUnit.get(normalizeUnit(effectiveUnitId)) ?? [])
        .filter((payment) => payment.clientId !== client.id && paymentMatchesClientIdentity(payment, client));
      const clientPayments = mergePaymentLists(directPayments, identityUnitPayments);
      const lastPayment = clientPayments[0];
      const contractTotal = provisionalRental
        ? roundMoney(Math.max(1, provisionalRental.charges.reduce((sum, charge) => sum + charge.amount, 0)))
        : roundMoney(Math.max(1, client.installmentsAgreed * client.rentAmount + sumOtherCharges(client)));
      const totalPaid = roundMoney(clamp(contractTotal - Math.max(0, effectiveBalance), 0, contractTotal));
      const percentPaid = provisionalRental
        ? Math.round((totalPaid / contractTotal) * 100)
        : computeInstallmentsPercent(client.installmentsAgreed, client.installmentsPaid);

      return {
        id: client.id,
        unitId: effectiveUnitId,
        name: client.name,
        cedula: client.cedula ?? "-",
        whatsAppPhone: client.whatsAppPhone,
        group: getGroupFromUnit(effectiveUnitId),
        plan: effectiveFrequency,
        weeklyChargeDay: provisionalRental ? undefined : client.frequency === "weekly" ? (client.weeklyChargeDay ?? "monday") : undefined,
        chargeFirstSunday: provisionalRental ? undefined : client.chargeFirstSunday,
        monthlyChargeDay: provisionalRental ? undefined : client.frequency === "monthly" ? client.monthlyChargeDay : undefined,
        nextDueDate,
        daysLate,
        overdueInstallments,
        overdueBalance,
        totalPending: roundMoney(Math.max(0, effectiveBalance)),
        lastPaymentDate: lastPayment?.dateApplied ?? null,
        lastPaymentAt: lastPayment?.createdAt ?? (lastPayment?.dateApplied ? `${lastPayment.dateApplied}T12:00:00` : null),
        lastPaymentAmount: roundMoney(lastPayment?.amountReceived ?? 0),
        percentPaid,
        installmentsAgreed: provisionalRental ? provisionalRental.charges.length : Math.max(0, client.installmentsAgreed),
        installmentsPaid: provisionalRental ? provisionalRental.charges.filter((charge) => charge.amountPaid >= charge.amount).length : Math.max(0, client.installmentsPaid),
        installmentsRemaining: provisionalRental ? provisionalRental.charges.filter((charge) => charge.amountPaid < charge.amount).length : Math.max(0, client.installmentsRemaining),
        rentAmount: roundMoney(Math.max(0, effectiveRentAmount)),
        contractTotal,
        totalPaid,
        state,
        totalOtherCharges: provisionalRental ? 0 : sumOtherCharges(client),
        recentPayments: clientPayments.slice(0, 5).map((payment) => ({
          id: payment.id,
          dateApplied: payment.dateApplied,
          createdAt: payment.createdAt,
          amountReceived: roundMoney(payment.amountReceived),
          appliedToRent: roundMoney(payment.appliedToRent)
        })),
        hasActiveClient: true,
        operationalStatus: client.activeProvisionalRental ? "provisional_rental" : operationalStatus
      } satisfies ReceivableRow;
  }

  function rowFromFleetUnit(unit: ControlUnitRow): ReceivableRow {
    const unitId = String(unit.unit_id ?? "").trim().toUpperCase();
    return {
      id: `fleet-${normalizeUnit(unitId)}`,
      unitId,
      name: "Sin cliente activo",
      cedula: "-",
      group: getGroupFromUnit(unitId),
      plan: "daily",
      nextDueDate: null,
      daysLate: -1,
      overdueInstallments: 0,
      overdueBalance: 0,
      totalPending: 0,
      lastPaymentDate: null,
      lastPaymentAt: null,
      lastPaymentAmount: 0,
      percentPaid: 0,
      installmentsAgreed: 0,
      installmentsPaid: 0,
      installmentsRemaining: 0,
      rentAmount: 0,
      contractTotal: 0,
      totalPaid: 0,
      state: "alDia",
      totalOtherCharges: 0,
      recentPayments: [],
      hasActiveClient: false,
      operationalStatus: String(unit.operational_status ?? "libre")
    };
  }

  if (fleetUnits.length === 0) return activeClients.map((client) => rowFromClient(client)).sort((a, b) => compareUnitIds(a.unitId, b.unitId));

  const rows: ReceivableRow[] = [];
  const seenUnits = new Set<string>();
  for (const unit of fleetUnits) {
    const unitId = typeof unit.unit_id === "string" ? unit.unit_id.trim().toUpperCase() : "";
    const normalizedUnit = normalizeUnit(unitId);
    if (!normalizedUnit || seenUnits.has(normalizedUnit)) continue;
    seenUnits.add(normalizedUnit);
    const client = activeClientByUnit.get(normalizedUnit);
    rows.push(client ? rowFromClient(client, String(unit.operational_status ?? client.status)) : rowFromFleetUnit({ ...unit, unit_id: unitId }));
  }
  for (const client of activeClients) {
    const normalizedUnit = normalizeUnit(client.activeProvisionalRental?.unitId ?? client.unitId);
    if (!normalizedUnit || seenUnits.has(normalizedUnit)) continue;
    seenUnits.add(normalizedUnit);
    rows.push(rowFromClient(client));
  }
  return rows.sort((a, b) => compareUnitIds(a.unitId, b.unitId));
}

function isInDateRange(value: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

export function filterReceivableRows(rows: ReceivableRow[], filters: ReceivableFilters): ReceivableRow[] {
  const clientSearch = filters.clientSearch.trim().toLowerCase();
  const unitSearch = filters.unitSearch.trim().toLowerCase();
  const cedulaSearch = filters.cedulaSearch.trim().toLowerCase();

  return rows.filter((row) => {
    if (clientSearch && !row.name.toLowerCase().includes(clientSearch)) return false;
    if (unitSearch && !row.unitId.toLowerCase().includes(unitSearch)) return false;
    if (cedulaSearch && !row.cedula.toLowerCase().includes(cedulaSearch)) return false;
    if (filters.state.length > 0 && !filters.state.includes(row.state)) return false;
    if (filters.group !== "all" && row.group !== filters.group) return false;
    if (filters.plan !== "all" && (!row.hasActiveClient || row.plan !== filters.plan)) return false;
    if (!isInDateRange(row.nextDueDate, filters.dateFrom, filters.dateTo)) return false;
    return true;
  });
}

function safeDateToSortValue(date: string | null): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return parseDateKey(date)?.getTime() ?? Number.POSITIVE_INFINITY;
}

export function sortReceivableRows(rows: ReceivableRow[], field: ReceivableSortField, direction: SortDirection): ReceivableRow[] {
  const planOrder: Record<BillingFrequency, number> = { daily: 1, weekly: 2, biweekly: 3, monthly: 4 };
  const stateOrder: Record<ReceivableState, number> = { alDia: 1, proximo: 2, venceHoy: 3, vencido: 4, critico: 5 };

  function compareText(a: string, b: string): number {
    return a.localeCompare(b, "es", { sensitivity: "base" });
  }

  function compareNullableDate(a: string | null, b: string | null): number {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const diff = safeDateToSortValue(a) - safeDateToSortValue(b);
    return direction === "asc" ? diff : -diff;
  }

  return [...rows].sort((a, b) => {
    let comparison = 0;

    if (field === "unitId") comparison = compareUnitIds(a.unitId, b.unitId);
    if (field === "name") comparison = compareText(a.name, b.name);
    if (field === "group") comparison = compareText(a.group, b.group);
    if (field === "plan") comparison = planOrder[a.plan] - planOrder[b.plan];
    if (field === "nextDueDate") comparison = compareNullableDate(a.nextDueDate, b.nextDueDate);
    if (field === "daysLate") comparison = a.daysLate - b.daysLate;
    if (field === "overdueBalance") comparison = a.overdueBalance - b.overdueBalance;
    if (field === "totalPending") comparison = a.totalPending - b.totalPending;
    if (field === "installmentsRemaining") comparison = a.installmentsRemaining - b.installmentsRemaining;
    if (field === "rentAmount") comparison = a.rentAmount - b.rentAmount;
    if (field === "lastPaymentDate") comparison = compareNullableDate(a.lastPaymentDate, b.lastPaymentDate);
    if (field === "percentPaid") comparison = a.percentPaid - b.percentPaid;
    if (field === "state") comparison = stateOrder[a.state] - stateOrder[b.state];

    if (field !== "nextDueDate" && field !== "lastPaymentDate") {
      comparison = direction === "asc" ? comparison : -comparison;
    }

    if (comparison === 0) {
      const tieBreak = compareUnitIds(a.unitId, b.unitId);
      comparison = direction === "asc" ? tieBreak : -tieBreak;
    }

    return comparison;
  });
}

export function computeReceivableSummary(rows: ReceivableRow[], payments: Payment[], now: Date): ReceivableSummary {
  const totalPorCobrar = roundMoney(rows.reduce((sum, row) => sum + row.totalPending, 0));
  const totalVencido = roundMoney(
    rows
      .filter((row) => row.state === "vencido" || row.state === "critico")
      .reduce((sum, row) => sum + row.overdueBalance, 0)
  );
  const proximoAVencer = roundMoney(
    rows
      .filter((row) => row.state === "proximo" || row.state === "venceHoy")
      .reduce((sum, row) => sum + row.totalPending, 0)
  );
  const clientesMorosos = rows.filter((row) => row.state === "vencido" || row.state === "critico").length;

  const visibleIds = new Set(rows.map((row) => row.id));
  const year = now.getFullYear();
  const month = now.getMonth();

  let cobradoEsteMes = payments
    .filter((payment) => visibleIds.has(payment.clientId))
    .reduce((sum, payment) => {
      const parsed = parseDateKey(payment.dateApplied);
      if (!parsed) return sum;
      if (parsed.getFullYear() !== year || parsed.getMonth() !== month) return sum;
      return sum + payment.amountReceived;
    }, 0);

  if (cobradoEsteMes === 0) {
    cobradoEsteMes = rows.reduce((sum, row) => {
      const parsed = row.lastPaymentDate ? parseDateKey(row.lastPaymentDate) : null;
      if (!parsed) return sum;
      if (parsed.getFullYear() !== year || parsed.getMonth() !== month) return sum;
      return sum + row.lastPaymentAmount;
    }, 0);
  }

  return {
    totalPorCobrar,
    totalVencido,
    proximoAVencer,
    clientesMorosos,
    cobradoEsteMes: roundMoney(cobradoEsteMes)
  };
}

function withOffsetDate(now: Date, offsetDays: number): string {
  const date = new Date(startOfDay(now));
  date.setDate(date.getDate() + offsetDays);
  return toDateKey(date);
}

export function createMockReceivableRows(now: Date): ReceivableRow[] {
  const rows: Array<Omit<ReceivableRow, "recentPayments"> & { recentPayments?: ReceivablePaymentSnapshot[] }> = [
    {
      id: "mock-1",
      unitId: "A-101",
      name: "Carlos Mendez",
      cedula: "8-233-110",
      group: "A",
      plan: "monthly",
      nextDueDate: withOffsetDate(now, -22),
      daysLate: 22,
      overdueInstallments: 2,
      overdueBalance: 820,
      totalPending: 820,
      lastPaymentDate: withOffsetDate(now, -30),
      lastPaymentAmount: 410,
      percentPaid: 40,
      installmentsAgreed: 100,
      installmentsPaid: 40,
      installmentsRemaining: 60,
      rentAmount: 410,
      contractTotal: 2050,
      totalPaid: 820,
      state: "critico",
      totalOtherCharges: 0,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-2",
      unitId: "B-205",
      name: "Mariela Vega",
      cedula: "8-511-442",
      group: "B",
      plan: "weekly",
      weeklyChargeDay: "wednesday",
      nextDueDate: withOffsetDate(now, -7),
      daysLate: 7,
      overdueInstallments: 1,
      overdueBalance: 195,
      totalPending: 390,
      lastPaymentDate: withOffsetDate(now, -5),
      lastPaymentAmount: 195,
      percentPaid: 58,
      installmentsAgreed: 60,
      installmentsPaid: 35,
      installmentsRemaining: 25,
      rentAmount: 195,
      contractTotal: 930,
      totalPaid: 540,
      state: "vencido",
      totalOtherCharges: 25,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-3",
      unitId: "C-044",
      name: "Ana Solis",
      cedula: "4-881-990",
      group: "C",
      plan: "daily",
      nextDueDate: withOffsetDate(now, -1),
      daysLate: 1,
      overdueInstallments: 1,
      overdueBalance: 35,
      totalPending: 175,
      lastPaymentDate: withOffsetDate(now, -2),
      lastPaymentAmount: 70,
      percentPaid: 71,
      installmentsAgreed: 45,
      installmentsPaid: 32,
      installmentsRemaining: 13,
      rentAmount: 35,
      contractTotal: 610,
      totalPaid: 435,
      state: "vencido",
      totalOtherCharges: 0,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-4",
      unitId: "D-010",
      name: "Eduardo Ruiz",
      cedula: "3-119-812",
      group: "D",
      plan: "biweekly",
      nextDueDate: withOffsetDate(now, 0),
      daysLate: -1,
      overdueInstallments: 0,
      overdueBalance: 0,
      totalPending: 260,
      lastPaymentDate: withOffsetDate(now, -14),
      lastPaymentAmount: 260,
      percentPaid: 50,
      installmentsAgreed: 20,
      installmentsPaid: 10,
      installmentsRemaining: 10,
      rentAmount: 260,
      contractTotal: 520,
      totalPaid: 260,
      state: "venceHoy",
      totalOtherCharges: 0,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-5",
      unitId: "T-311",
      name: "Ruth Paredes",
      cedula: "8-723-205",
      group: "T",
      plan: "monthly",
      nextDueDate: withOffsetDate(now, 2),
      daysLate: -1,
      overdueInstallments: 0,
      overdueBalance: 0,
      totalPending: 305,
      lastPaymentDate: withOffsetDate(now, -12),
      lastPaymentAmount: 305,
      percentPaid: 63,
      installmentsAgreed: 40,
      installmentsPaid: 25,
      installmentsRemaining: 15,
      rentAmount: 305,
      contractTotal: 820,
      totalPaid: 515,
      state: "proximo",
      totalOtherCharges: 30,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-6",
      unitId: "A-118",
      name: "Luis Gomez",
      cedula: "5-102-402",
      group: "A",
      plan: "weekly",
      weeklyChargeDay: "monday",
      nextDueDate: withOffsetDate(now, 3),
      daysLate: -1,
      overdueInstallments: 0,
      overdueBalance: 0,
      totalPending: 0,
      lastPaymentDate: withOffsetDate(now, -1),
      lastPaymentAmount: 210,
      percentPaid: 100,
      installmentsAgreed: 62,
      installmentsPaid: 62,
      installmentsRemaining: 0,
      rentAmount: 210,
      contractTotal: 1240,
      totalPaid: 1240,
      state: "alDia",
      totalOtherCharges: 0,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-7",
      unitId: "B-119",
      name: "Diana Cortez",
      cedula: "PE-9931",
      group: "B",
      plan: "monthly",
      nextDueDate: withOffsetDate(now, -16),
      daysLate: 16,
      overdueInstallments: 1,
      overdueBalance: 480,
      totalPending: 960,
      lastPaymentDate: withOffsetDate(now, -27),
      lastPaymentAmount: 480,
      percentPaid: 20,
      installmentsAgreed: 50,
      installmentsPaid: 10,
      installmentsRemaining: 40,
      rentAmount: 480,
      contractTotal: 4800,
      totalPaid: 960,
      state: "critico",
      totalOtherCharges: 0,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-8",
      unitId: "C-071",
      name: "Jorge Batista",
      cedula: "7-487-611",
      group: "C",
      plan: "daily",
      nextDueDate: withOffsetDate(now, 1),
      daysLate: -1,
      overdueInstallments: 0,
      overdueBalance: 0,
      totalPending: 140,
      lastPaymentDate: withOffsetDate(now, -3),
      lastPaymentAmount: 35,
      percentPaid: 32,
      installmentsAgreed: 50,
      installmentsPaid: 16,
      installmentsRemaining: 34,
      rentAmount: 35,
      contractTotal: 440,
      totalPaid: 140,
      state: "proximo",
      totalOtherCharges: 0,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-9",
      unitId: "D-404",
      name: "Marta Salazar",
      cedula: "8-000-551",
      group: "D",
      plan: "biweekly",
      nextDueDate: withOffsetDate(now, -4),
      daysLate: 4,
      overdueInstallments: 1,
      overdueBalance: 185,
      totalPending: 370,
      lastPaymentDate: withOffsetDate(now, -9),
      lastPaymentAmount: 185,
      percentPaid: 48,
      installmentsAgreed: 50,
      installmentsPaid: 24,
      installmentsRemaining: 26,
      rentAmount: 185,
      contractTotal: 710,
      totalPaid: 340,
      state: "vencido",
      totalOtherCharges: 15,
      hasActiveClient: true,
      operationalStatus: "activo"
    },
    {
      id: "mock-10",
      unitId: "T-090",
      name: "Nelson Quintero",
      cedula: "N-88201",
      group: "T",
      plan: "weekly",
      weeklyChargeDay: "friday",
      nextDueDate: withOffsetDate(now, 6),
      daysLate: 0,
      overdueInstallments: 0,
      overdueBalance: 0,
      totalPending: 0,
      lastPaymentDate: withOffsetDate(now, -2),
      lastPaymentAmount: 190,
      percentPaid: 93,
      installmentsAgreed: 30,
      installmentsPaid: 28,
      installmentsRemaining: 2,
      rentAmount: 190,
      contractTotal: 1330,
      totalPaid: 1240,
      state: "alDia",
      totalOtherCharges: 0,
      hasActiveClient: true,
      operationalStatus: "activo"
    }
  ];

  return rows.map((row) => ({
    ...row,
    recentPayments: row.lastPaymentDate
      ? [
          {
            id: `${row.id}-pay-1`,
            dateApplied: row.lastPaymentDate,
            amountReceived: row.lastPaymentAmount,
            appliedToRent: roundMoney(Math.max(0, row.lastPaymentAmount - row.totalOtherCharges))
          }
        ]
      : []
  }));
}

export const DEFAULT_RECEIVABLE_FILTERS: ReceivableFilters = {
  clientSearch: "",
  unitSearch: "",
  cedulaSearch: "",
  state: [],
  group: "all",
  plan: "all",
  dateFrom: "",
  dateTo: ""
};
