import { useEffect, useMemo, useState } from "react";
import { getBusinessDateKey, isBeforeFirstChargeDate, isChargeDay, parseDateKey, resolveInstallmentIssuance, toDateKey } from "../../billing";
import { applyPendingCashClosingCharges, getCashClosingDateError, getLastClosableDateKey } from "../../cashClosingRules";
import {
  loadCloudCashClosingAudit,
  loadCloudCashClosings,
  loadCloudChargeRunLateFeeEntryIds,
  loadCloudChargeRunSnapshots,
  loadCloudChargeRuns,
  saveCloudCashClosingAudit,
  saveCloudCashClosings,
  saveCloudChargeRuns
} from "../../cloudData";
import { formatCurrency } from "../../format";
import { applyLateFeesForClosingDate, subtractOtherCharge } from "../../lateFees";
import { supabase } from "../../lib/supabase";
import { isSupabaseOnlyMode } from "../../persistenceMode";
import { loadLateFeeLedger, saveLateFeeLedger } from "../../storage";
import type { Client, LateFeeLedgerEntry, LateFeeSettings, Payment } from "../../types";
import { loadCashSummaryRange } from "../../cashLedger";
import { stableEqual } from "../../stableSerialize";
import { accrueClientProvisionalRental } from "../../provisionalRentals";
import { roundMoney } from "./paymentRules";
import {
  loadCashClosingAudit,
  loadCashClosings,
  loadChargeRuns,
  saveCashClosingAudit,
  saveCashClosings,
  saveChargeRuns
} from "./paymentStorage";
import type {
  CashClosing,
  CashClosingAuditEvent,
  ChargeApplyResult,
  CashCloseClientSnapshot,
  ChargeCloseReport,
  ChargeReportRow,
  ChargeRun
} from "./paymentTypes";

type Options = {
  clients: Client[];
  payments: Payment[];
  lateFeeSettings: LateFeeSettings;
  onClientsChange: (next: Client[]) => void | Promise<void>;
  onCashClose?: () => void;
  dataOwnerUserId?: string | null;
};

type InternalChargeApplyResult = ChargeApplyResult & {
  nextClients: Client[];
  newLateFeeEntries: LateFeeLedgerEntry[];
  clientSnapshots: CashCloseClientSnapshot[];
  run?: ChargeRun;
};

function dedupeCashClosings(rows: CashClosing[]): CashClosing[] {
  const byDate = new Map<string, CashClosing>();
  for (const closing of rows) {
    if (typeof closing.date !== "string" || typeof closing.closedAt !== "string") continue;
    const existing = byDate.get(closing.date);
    if (!existing || closing.closedAt >= existing.closedAt) {
      byDate.set(closing.date, closing);
    }
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export default function useCashClosing({
  clients,
  payments,
  lateFeeSettings,
  onClientsChange,
  onCashClose,
  dataOwnerUserId
}: Options) {
  const [cashClosings, setCashClosings] = useState<CashClosing[]>(() => (isSupabaseOnlyMode ? [] : loadCashClosings()));
  const [cashClosingDate, setCashClosingDate] = useState<string>(getBusinessDateKey());
  const [cashClosingActor, setCashClosingActor] = useState<string>("Operador");
  const [cashClosingInfo, setCashClosingInfo] = useState<string>("");
  const [cashClosingError, setCashClosingError] = useState<string>("");
  const [cashClosingAudit, setCashClosingAudit] = useState<CashClosingAuditEvent[]>(() => (isSupabaseOnlyMode ? [] : loadCashClosingAudit()));
  const [chargeRuns, setChargeRuns] = useState<ChargeRun[]>(() => (isSupabaseOnlyMode ? [] : loadChargeRuns()));
  const [lateFeeLedger, setLateFeeLedger] = useState<LateFeeLedgerEntry[]>(() => loadLateFeeLedger());
  const [lastCloseReport, setLastCloseReport] = useState<ChargeCloseReport | null>(null);
  const [reopenTargetDate, setReopenTargetDate] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState<string>("");
  const [cashLedgerClosedDates, setCashLedgerClosedDates] = useState<string[]>([]);
  const [isClosingCash, setIsClosingCash] = useState(false);

  async function loadCashClosingCloudState(ownerUserId: string): Promise<void> {
    const [cloudClosings, cloudAudit, cloudRuns] = await Promise.all([
      loadCloudCashClosings(ownerUserId),
      loadCloudCashClosingAudit(ownerUserId),
      loadCloudChargeRuns(ownerUserId)
    ]);
    const today = getBusinessDateKey();
    const todayDate = parseDateKey(today);
    let ledgerFromDate = today;
    if (todayDate) {
      const fromDate = new Date(todayDate);
      fromDate.setDate(fromDate.getDate() - 90);
      ledgerFromDate = toDateKey(fromDate);
    }
    const ledgerSummaries = await loadCashSummaryRange(ledgerFromDate, today, ownerUserId).catch((error) => {
      console.error("No se pudieron cargar cierres del ledger de caja.", error);
      return [];
    });
    const normalizedClosings = dedupeCashClosings(cloudClosings);
    const normalizedAudit = cloudAudit
      .filter((event) => typeof event.id === "string" && typeof event.date === "string" && typeof event.createdAt === "string")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const normalizedRuns = cloudRuns
      .filter((run) => typeof run.id === "string" && typeof run.targetDate === "string")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const normalizedLedgerClosedDates = ledgerSummaries
      .filter((summary) => summary.status === "closed" && typeof summary.opening_date === "string")
      .map((summary) => summary.opening_date)
      .sort((a, b) => b.localeCompare(a));
    setCashClosings(normalizedClosings);
    setCashClosingAudit(normalizedAudit);
    setChargeRuns(normalizedRuns);
    setCashLedgerClosedDates(normalizedLedgerClosedDates);
    if (!isSupabaseOnlyMode) {
      saveCashClosings(normalizedClosings);
      saveCashClosingAudit(normalizedAudit);
      saveChargeRuns(normalizedRuns);
    }
  }

  useEffect(() => {
    if (!dataOwnerUserId) return;
    let active = true;
    void loadCashClosingCloudState(dataOwnerUserId).then(() => {
      if (!active) return;
    }).catch((error) => {
      console.error("No se pudieron cargar cierres de caja desde nube.", error);
      if (active) setCashClosingError("No se pudieron cargar los cierres desde nube. Actualiza e intenta de nuevo.");
    });
    return () => {
      active = false;
    };
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    let reloadTimer: number | null = null;
    const scheduleReload = () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void loadCashClosingCloudState(dataOwnerUserId).catch((error) => {
          console.error("No se pudo refrescar cierre de caja desde nube.", error);
        });
      }, 300);
    };
    const channel = client
      .channel(`cash-closing-live-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_closings_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_closing_audit_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "charge_runs_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "charge_run_headers_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_day_closings", filter: `owner_user_id=eq.${dataOwnerUserId}` }, scheduleReload)
      .subscribe();
    return () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

  async function persistCashClosings(next: CashClosing[]): Promise<void> {
    const normalized = dedupeCashClosings(next);
    setCashClosings(normalized);
    if (!isSupabaseOnlyMode) saveCashClosings(normalized);
    if (dataOwnerUserId) {
      await saveCloudCashClosings(dataOwnerUserId, normalized);
    }
  }

  async function persistCashClosingAudit(next: CashClosingAuditEvent[]): Promise<void> {
    setCashClosingAudit(next);
    if (!isSupabaseOnlyMode) saveCashClosingAudit(next);
    if (dataOwnerUserId) {
      await saveCloudCashClosingAudit(dataOwnerUserId, next);
    }
  }

  async function persistChargeRuns(next: ChargeRun[]): Promise<void> {
    setChargeRuns(next);
    if (!isSupabaseOnlyMode) saveChargeRuns(next);
    if (dataOwnerUserId) {
      await saveCloudChargeRuns(dataOwnerUserId, next);
    }
  }

  const closedDateSet = useMemo(
    () => new Set([
      ...cashClosings.map((closing) => closing.date),
      ...cashLedgerClosedDates
    ]),
    [cashClosings, cashLedgerClosedDates]
  );

  const nextUnclosedDateKey = useMemo(() => {
    const today = getBusinessDateKey();
    const candidates = [...closedDateSet].map((date) => date.trim()).filter((date) => date.length > 0);
    if (candidates.length === 0) return getLastClosableDateKey();
    const sortedClosedDates = [...new Set(candidates)].sort();
    const latestClosed = sortedClosedDates[sortedClosedDates.length - 1];
    if (!latestClosed) return today;
    const latestClosedDate = parseDateKey(latestClosed);
    if (!latestClosedDate) return today;
    const nextOperational = new Date(latestClosedDate);
    nextOperational.setDate(nextOperational.getDate() + 1);
    return toDateKey(nextOperational);
  }, [closedDateSet]);

  const operationalDateKey = useMemo(() => {
    const today = getBusinessDateKey();
    return nextUnclosedDateKey < today ? today : nextUnclosedDateKey;
  }, [nextUnclosedDateKey]);

  useEffect(() => {
    setCashClosingDate((previous) => previous === nextUnclosedDateKey ? previous : nextUnclosedDateKey);
  }, [nextUnclosedDateKey]);

function isDateClosed(dateKey: string): boolean {
  return closedDateSet.has(dateKey);
}

function cloneOtherCharges(client: Client): Client["otherCharges"] {
  return (client.otherCharges ?? []).map((charge) => ({ ...charge }));
}

function financialPayload(client: Client) {
  return {
    balance: roundMoney(client.balance),
    advanceBalance: roundMoney(client.advanceBalance ?? 0),
    lastChargeDate: client.lastChargeDate,
    firstSundayChargedAt: client.firstSundayChargedAt,
    installmentsIssued: resolveInstallmentIssuance(client).issued,
    installmentsIssuedEstimateNeedsReview: resolveInstallmentIssuance(client).needsReview,
    otherCharges: cloneOtherCharges(client),
    activeProvisionalRental: client.activeProvisionalRental
  };
}

function buildClientSnapshots(beforeClients: Client[], afterClients: Client[]): CashCloseClientSnapshot[] {
  const beforeById = new Map(beforeClients.map((client) => [client.id, client]));
  return afterClients
    .map((after): CashCloseClientSnapshot | null => {
      const before = beforeById.get(after.id);
      if (!before) return null;
      const beforePayload = financialPayload(before);
      const afterPayload = financialPayload(after);
      if (stableEqual(beforePayload, afterPayload)) return null;
      return {
        clientId: after.id,
        unitId: after.unitId,
        name: after.name,
        before: beforePayload,
        after: afterPayload
      } satisfies CashCloseClientSnapshot;
    })
    .filter((snapshot): snapshot is CashCloseClientSnapshot => snapshot !== null);
}

function isPendingRunApplied(run: ChargeRun, currentClients: Client[]): boolean {
  const currentById = new Map(currentClients.map((client) => [client.id, client]));
  return (run.clientSnapshots ?? []).every((snapshot) => {
    const current = currentById.get(snapshot.clientId);
    if (!current) return false;
    return stableEqual(financialPayload(current), snapshot.after);
  });
}

function applyNextDayChargesFromClosing(
  closingDateKey: string,
  options: { repairExistingRun?: boolean; forceIncompleteZeroRun?: boolean } = {},
  sourceClients: Client[] = clients,
  sourceChargeRuns: ChargeRun[] = chargeRuns
): InternalChargeApplyResult {
  const closingDate = parseDateKey(closingDateKey);
  if (!closingDate) {
    return {
      targetDate: closingDateKey,
      alreadyProcessed: true,
      expectedClients: 0,
      chargedClients: 0,
      anomalyClients: 0,
      chargedTotal: 0,
      lateFeeClients: 0,
      lateFeeTotal: 0,
      rows: [],
      nextClients: sourceClients,
      newLateFeeEntries: [],
      clientSnapshots: []
    };
  }
  const targetDate = new Date(closingDate);
  targetDate.setDate(targetDate.getDate() + 1);
  const targetDateKey = toDateKey(targetDate);
  const pendingRun = sourceChargeRuns.find((r) =>
    r.targetDate === targetDateKey &&
    r.status === "pending" &&
    Array.isArray(r.clientSnapshots) &&
    r.clientSnapshots.length > 0 &&
    isPendingRunApplied(r, sourceClients)
  );
  if (pendingRun) {
    return {
      targetDate: targetDateKey,
      alreadyProcessed: true,
      expectedClients: pendingRun.expectedClients,
      chargedClients: pendingRun.chargedClients,
      anomalyClients: pendingRun.anomalyClients,
      chargedTotal: pendingRun.chargedTotal,
      lateFeeClients: 0,
      lateFeeTotal: 0,
      rows: [],
      nextClients: sourceClients,
      newLateFeeEntries: [],
      clientSnapshots: pendingRun.clientSnapshots ?? [],
      run: { ...pendingRun, status: "completed" }
    };
  }
  const existingRun = sourceChargeRuns.find((r) => r.targetDate === targetDateKey && r.status !== "pending" && r.status !== "reverted");
  const alreadyProcessed = !!existingRun;
  const shouldForceIncompleteZeroRun = !!(
    options.forceIncompleteZeroRun &&
    existingRun &&
    existingRun.chargedClients === 0 &&
    roundMoney(existingRun.chargedTotal) === 0
  );

  const lateFeeResult = applyLateFeesForClosingDate({
    clients: sourceClients,
    payments,
    lateFeeLedger,
    lateFeeSettings,
    closingDateKey
  });
  const clientsWithLateFees = lateFeeResult.clients;
  const newLateFeeEntries = lateFeeResult.newEntries;
  const lateFeeClients = lateFeeResult.lateFeeClients;
  const lateFeeTotal = lateFeeResult.lateFeeTotal;

  if (alreadyProcessed && !options.repairExistingRun) {
    return {
      targetDate: targetDateKey,
      alreadyProcessed: true,
      expectedClients: 0,
      chargedClients: 0,
      anomalyClients: 0,
      chargedTotal: 0,
      lateFeeClients,
      lateFeeTotal,
      rows: [],
      nextClients: clientsWithLateFees,
      newLateFeeEntries,
      clientSnapshots: buildClientSnapshots(sourceClients, clientsWithLateFees)
    };
  }

  let expectedClients = 0;
  let chargedClients = 0;
  let anomalyClients = 0;
  let chargedTotal = 0;
  const rows: ChargeReportRow[] = [];
  const nextClients = clientsWithLateFees.map((client) => {
    const preClosingClient = sourceClients.find((candidate) => candidate.id === client.id) ?? client;
    if (preClosingClient.activeProvisionalRental) {
      return accrueClientProvisionalRental(preClosingClient, targetDateKey);
    }
    if (
      client.archivedAt ||
      client.status === "archivado" ||
      client.status === "taller" ||
      client.status === "chapisteria" ||
      client.status === "custodia"
    ) {
      return client;
    }
    const clientLastCharge = client.lastChargeDate ? parseDateKey(client.lastChargeDate) : null;
    const alreadyChargedThruTarget = clientLastCharge !== null && clientLastCharge >= targetDate;
    const dateWasAdvancedWithoutCharge = !!(
      shouldForceIncompleteZeroRun &&
      clientLastCharge !== null &&
      toDateKey(clientLastCharge) === targetDateKey
    );
    const isBeforeFirstCharge = isBeforeFirstChargeDate(client, targetDate);
    const canCharge = Number.isFinite(client.rentAmount) && client.rentAmount > 0;
    const issuance = resolveInstallmentIssuance(client);
    const hasContractInstallmentsToIssue = issuance.issued < Math.max(0, Math.floor(client.installmentsAgreed));
    const isScheduledChargeDay = canCharge && !isBeforeFirstCharge && isChargeDay(client, targetDate);
    const shouldChargeByRule = isScheduledChargeDay && hasContractInstallmentsToIssue;
    if (shouldChargeByRule) expectedClients += 1;
    const balanceBefore = roundMoney(client.balance);
    const lastBefore = client.lastChargeDate ?? "-";

    if (shouldChargeByRule && alreadyChargedThruTarget && !dateWasAdvancedWithoutCharge) {
      rows.push({
        clientId: client.id,
        unitId: client.unitId,
        name: client.name,
        shouldCharge: true,
        charged: false,
        anomaly: false,
        reason: "Cobro ya aplicado previamente",
        balanceBefore,
        balanceAfter: balanceBefore,
        chargedAmount: 0,
        lastChargeDateBefore: lastBefore,
        lastChargeDateAfter: lastBefore
      });
      return client;
    }

    const shouldCharge = (!alreadyChargedThruTarget || dateWasAdvancedWithoutCharge) && shouldChargeByRule;
    if (!shouldCharge) {
      const reason = alreadyChargedThruTarget
        ? "Sin cobro: fecha ya cubierta"
        : isBeforeFirstCharge
          ? "Sin cobro: antes de fecha primer cobro"
          : isScheduledChargeDay && !hasContractInstallmentsToIssue
            ? "Sin cobro: todas las cuotas pactadas fueron emitidas"
          : shouldChargeByRule
          ? "Sin cobro por estado de fecha"
          : "No corresponde por regla";
      const lastAfter = alreadyChargedThruTarget
        ? (client.lastChargeDate ?? targetDateKey)
        : targetDateKey;
      rows.push({
        clientId: client.id,
        unitId: client.unitId,
        name: client.name,
        shouldCharge: shouldChargeByRule,
        charged: false,
        anomaly: false,
        reason,
        balanceBefore,
        balanceAfter: balanceBefore,
        chargedAmount: 0,
        lastChargeDateBefore: lastBefore,
        lastChargeDateAfter: lastAfter
      });
      if (alreadyChargedThruTarget) return client;
      return { ...client, lastChargeDate: targetDateKey };
    }
    chargedClients += 1;
    const isFirstSundayCharge = client.frequency === "daily" && targetDate.getDay() === 0 && !!client.chargeFirstSunday && !client.firstSundayChargedAt;
    const currentAdvance = roundMoney(client.advanceBalance ?? 0);
    const consumedAdvance = roundMoney(Math.min(currentAdvance, client.rentAmount));
    const uncoveredRent = roundMoney(Math.max(0, client.rentAmount - consumedAdvance));
    const balanceAfter = roundMoney(client.balance + uncoveredRent);
    chargedTotal = roundMoney(chargedTotal + uncoveredRent);
    rows.push({
      clientId: client.id,
      unitId: client.unitId,
      name: client.name,
      shouldCharge: true,
      charged: true,
      anomaly: false,
      reason: consumedAdvance > 0 ? "Cobrado con consumo de adelanto" : "Cobrado",
      balanceBefore,
      balanceAfter,
      chargedAmount: uncoveredRent,
      lastChargeDateBefore: lastBefore,
      lastChargeDateAfter: targetDateKey
    });
    return {
      ...client,
      balance: balanceAfter,
      advanceBalance: roundMoney(Math.max(0, currentAdvance - consumedAdvance)),
      installmentsIssued: issuance.issued + 1,
      installmentsIssuedEstimateNeedsReview: issuance.needsReview,
      firstSundayChargedAt: isFirstSundayCharge ? targetDateKey : client.firstSundayChargedAt,
      lastChargeDate: targetDateKey
    };
  });

  if (anomalyClients > 0) {
    return {
      targetDate: targetDateKey,
      alreadyProcessed,
      expectedClients,
      chargedClients,
      anomalyClients,
      chargedTotal,
      lateFeeClients: 0,
      lateFeeTotal: 0,
      rows,
      nextClients: sourceClients,
      newLateFeeEntries: [],
      clientSnapshots: [],
      blockingError: `No se pudo cerrar: ${anomalyClients} cliente(s) tenian estado inconsistente para ${targetDateKey}.`
    };
  }

  const run: ChargeRun = {
    id: crypto.randomUUID(),
    closingDate: closingDateKey,
    targetDate: targetDateKey,
    expectedClients,
    chargedClients,
    anomalyClients,
    chargedTotal,
    createdAt: new Date().toISOString(),
    status: "pending",
    clientSnapshots: buildClientSnapshots(sourceClients, nextClients),
    lateFeeEntryIds: newLateFeeEntries.map((entry) => entry.id)
  };

  return {
    targetDate: targetDateKey,
    alreadyProcessed,
    expectedClients,
    chargedClients,
    anomalyClients,
    chargedTotal,
    lateFeeClients,
    lateFeeTotal,
    rows,
    nextClients,
    newLateFeeEntries,
    clientSnapshots: run.clientSnapshots ?? [],
    run
  };
}

function mergeClientSnapshots(
  existingSnapshots: CashCloseClientSnapshot[],
  repairSnapshots: CashCloseClientSnapshot[]
): CashCloseClientSnapshot[] {
  const byClientId = new Map(existingSnapshots.map((snapshot) => [snapshot.clientId, snapshot]));
  for (const repair of repairSnapshots) {
    const existing = byClientId.get(repair.clientId);
    byClientId.set(repair.clientId, existing
      ? { ...repair, before: existing.before }
      : repair);
  }
  return [...byClientId.values()];
}

async function buildSameDayRepairRun(
  targetDateKey: string,
  repairedClients: Client[],
  chargedClients: number,
  chargedTotal: number
): Promise<ChargeRun | null> {
  if (chargedClients === 0) return null;
  const targetDate = parseDateKey(targetDateKey);
  if (!targetDate) return null;
  const previousDate = new Date(targetDate);
  previousDate.setDate(previousDate.getDate() - 1);
  const existingRun = chargeRuns.find((run) => run.targetDate === targetDateKey && run.status !== "reverted");
  let existingSnapshots = existingRun?.clientSnapshots ?? [];
  let existingLateFeeEntryIds = existingRun?.lateFeeEntryIds ?? [];
  if (existingRun && dataOwnerUserId) {
    [existingSnapshots, existingLateFeeEntryIds] = await Promise.all([
      existingSnapshots.length > 0
        ? Promise.resolve(existingSnapshots)
        : loadCloudChargeRunSnapshots(dataOwnerUserId, existingRun.id),
      existingLateFeeEntryIds.length > 0
        ? Promise.resolve(existingLateFeeEntryIds)
        : loadCloudChargeRunLateFeeEntryIds(dataOwnerUserId, existingRun.id)
    ]);
  }
  const repairSnapshots = buildClientSnapshots(clients, repairedClients);
  return {
    id: existingRun?.id ?? crypto.randomUUID(),
    closingDate: existingRun?.closingDate ?? toDateKey(previousDate),
    targetDate: targetDateKey,
    expectedClients: (existingRun?.expectedClients ?? 0) + chargedClients,
    chargedClients: (existingRun?.chargedClients ?? 0) + chargedClients,
    anomalyClients: existingRun?.anomalyClients ?? 0,
    chargedTotal: roundMoney((existingRun?.chargedTotal ?? 0) + chargedTotal),
    createdAt: existingRun?.createdAt ?? new Date().toISOString(),
    status: "pending",
    clientSnapshots: mergeClientSnapshots(existingSnapshots, repairSnapshots),
    lateFeeEntryIds: existingLateFeeEntryIds
  };
}

async function isDateClosedInCloud(date: string, ownerUserId: string): Promise<boolean> {
  const [cloudClosings, ledgerRows] = await Promise.all([
    loadCloudCashClosings(ownerUserId),
    loadCashSummaryRange(date, date, ownerUserId).catch(() => [])
  ]);
  return (
    cloudClosings.some((closing) => closing.date === date) ||
    ledgerRows.some((row) => row.opening_date === date && row.status === "closed")
  );
}

async function handleCloseCashForDate(): Promise<void> {
  if (isClosingCash) return;
  const date = cashClosingDate.trim();
  const actor = cashClosingActor.trim() || "Operador";
  const reason = "Cierre diario";
  if (!dataOwnerUserId) {
    setCashClosingError("No se puede cerrar caja sin conexion a la nube del negocio. Actualiza e intenta de nuevo.");
    setCashClosingInfo("");
    return;
  }
  const dateError = getCashClosingDateError(date);
  if (dateError) {
    setCashClosingError(dateError);
    setCashClosingInfo("");
    return;
  }
  if (isDateClosed(date)) {
    setCashClosingDate(nextUnclosedDateKey);
    setLastCloseReport(null);
    setCashClosingError("");
    setCashClosingInfo(`La caja de ${date} ya estaba cerrada. La fecha a cerrar se movio a ${nextUnclosedDateKey}; no se aplicaron cobros.`);
    return;
  }

  setIsClosingCash(true);
  setCashClosingError("");
  setCashClosingInfo("Validando cierre en nube...");
  try {
    if (await isDateClosedInCloud(date, dataOwnerUserId)) {
      await loadCashClosingCloudState(dataOwnerUserId);
      setCashClosingDate(nextUnclosedDateKey);
      setLastCloseReport(null);
      setCashClosingError("");
      setCashClosingInfo(`La caja de ${date} ya esta cerrada en nube. Se actualizo el estado local; no se aplicaron cobros.`);
      return;
    }

    const sameDayRepair = applyPendingCashClosingCharges(clients, date);
    const chargeResult = applyNextDayChargesFromClosing(date, {}, sameDayRepair.clients);
    const closeReport: ChargeCloseReport = {
      closingDate: date,
      targetDate: chargeResult.targetDate,
      status: chargeResult.blockingError ? "warning" : "ok",
      expectedClients: chargeResult.expectedClients,
      chargedClients: chargeResult.chargedClients,
      anomalyClients: chargeResult.anomalyClients,
      chargedTotal: chargeResult.chargedTotal,
      generatedAt: new Date().toISOString(),
      rows: chargeResult.rows
    };
    setLastCloseReport(closeReport);

    if (chargeResult.blockingError) {
      setCashClosingError(chargeResult.blockingError);
      setCashClosingInfo("");
      return;
    }

    const confirmMessage = [
      `Cerrar caja de ${date}.`,
      sameDayRepair.chargedClients > 0
        ? `Primero se repararan ${sameDayRepair.chargedClients} cargo(s) pendiente(s) de ${date}, por ${formatCurrency(sameDayRepair.chargedTotal)}.`
        : "",
      chargeResult.alreadyProcessed
        ? `Los cargos para ${chargeResult.targetDate} ya estan aplicados; se completara el cierre pendiente.`
        : `Se aplicaran cargos automaticos para ${chargeResult.targetDate}.`,
      `Clientes esperados: ${chargeResult.expectedClients}.`,
      `Clientes cargados: ${chargeResult.chargedClients}.`,
      `Total cargado: ${formatCurrency(chargeResult.chargedTotal)}.`,
      chargeResult.lateFeeClients > 0
        ? `Recargos por tardanza: ${chargeResult.lateFeeClients} cliente(s), ${formatCurrency(chargeResult.lateFeeTotal)}.`
        : "",
      "Esta operacion guardara un snapshot para poder revertir la reapertura."
    ].filter(Boolean).join("\n");
    if (!window.confirm(confirmMessage)) {
      setCashClosingInfo("Cierre cancelado. No se aplicaron cambios.");
      setCashClosingError("");
      return;
    }

    setCashClosingInfo("Guardando cargos y cierre...");
    if (chargeResult.newLateFeeEntries.length > 0) {
      const nextLedger = [...chargeResult.newLateFeeEntries, ...lateFeeLedger].slice(0, 10000);
      setLateFeeLedger(nextLedger);
      saveLateFeeLedger(nextLedger);
    }

    let nextRuns = chargeRuns;
    const repairRun = await buildSameDayRepairRun(
      date,
      sameDayRepair.clients,
      sameDayRepair.chargedClients,
      sameDayRepair.chargedTotal
    );
    if (repairRun) {
      nextRuns = [repairRun, ...nextRuns.filter((item) => item.id !== repairRun.id)].slice(0, 400);
    }
    if (chargeResult.run) {
      nextRuns = [
        chargeResult.run,
        ...nextRuns.filter((item) => item.targetDate !== chargeResult.targetDate || item.status === "reverted")
      ].slice(0, 400);
    }
    if (repairRun || chargeResult.run) {
      await persistChargeRuns(nextRuns);
    }

    await onClientsChange(chargeResult.nextClients);

    if (repairRun || chargeResult.run) {
      const completedRunIds = new Set([repairRun?.id, chargeResult.run?.id].filter((id): id is string => Boolean(id)));
      nextRuns = nextRuns.map((run) => completedRunIds.has(run.id) ? { ...run, status: "completed" } : run);
      await persistChargeRuns(nextRuns);
    }

    const closing: CashClosing = { date, closedAt: new Date().toISOString() };
    const nextClosings = [...cashClosings, closing].sort((a, b) => b.date.localeCompare(a.date));
    await persistCashClosings(nextClosings);

    const paymentsOfDay = payments.filter((p) => p.dateApplied === date);
    const dayTotal = roundMoney(paymentsOfDay.reduce((acc, p) => acc + p.amountReceived, 0));
    const event: CashClosingAuditEvent = {
      id: crypto.randomUUID(),
      date,
      action: "close",
      actor,
      reason,
      createdAt: new Date().toISOString()
    };
    const nextAudit = [event, ...cashClosingAudit].slice(0, 300);
    await persistCashClosingAudit(nextAudit);

    const chargeInfo = chargeResult.alreadyProcessed
      ? `Cobros de ${chargeResult.targetDate} ya estaban aplicados previamente.`
      : `Cobros aplicados para ${chargeResult.targetDate}: esperados ${chargeResult.expectedClients}, cobrados ${chargeResult.chargedClients}, total ${formatCurrency(chargeResult.chargedTotal)}.`;
    const lateFeeInfo = chargeResult.lateFeeClients > 0
      ? ` Recargos por tardanza: ${chargeResult.lateFeeClients} cliente(s), total ${formatCurrency(chargeResult.lateFeeTotal)}.`
      : "";
    const repairInfo = sameDayRepair.chargedClients > 0
      ? ` Se repararon ${sameDayRepair.chargedClients} cargo(s) pendiente(s) de ${date}, total ${formatCurrency(sameDayRepair.chargedTotal)}.`
      : "";
    setCashClosingError("");
    setCashClosingInfo(
      `Caja cerrada para ${date}. Pagos del dia: ${paymentsOfDay.length}. Total del dia: ${formatCurrency(dayTotal)}.${repairInfo} ${chargeInfo}${lateFeeInfo}`
    );
    onCashClose?.();
  } catch (error) {
    console.error("No se pudo completar el cierre de caja.", error);
    const message = error instanceof Error ? error.message : "No se pudo completar el cierre de caja.";
    setCashClosingError(`Cierre no completado: ${message}`);
    setCashClosingInfo("");
    if (dataOwnerUserId) {
      await loadCashClosingCloudState(dataOwnerUserId).catch(() => undefined);
    }
  } finally {
    setIsClosingCash(false);
  }
}

function openReopenDialog(date: string): void {
  setReopenTargetDate(date);
  setReopenReason("");
  setCashClosingError("");
}

async function handleConfirmReopen(): Promise<void> {
  if (!reopenTargetDate) return;
  if (!dataOwnerUserId) {
    setCashClosingError("No se puede reabrir caja sin conexion a la nube del negocio. Actualiza e intenta de nuevo.");
    return;
  }
  const reason = reopenReason.trim();
  const actor = cashClosingActor.trim() || "Operador";
  if (!reason) {
    setCashClosingError("Debes indicar un motivo para reabrir caja.");
    return;
  }
  if (!isDateClosed(reopenTargetDate)) {
    setCashClosingError(`La caja de ${reopenTargetDate} ya no esta cerrada.`);
    setReopenTargetDate(null);
    return;
  }

  setIsClosingCash(true);
  setCashClosingInfo("Revirtiendo cierre...");
  setCashClosingError("");
  try {
    const candidateRunToRevert = chargeRuns.find((run) =>
      run.closingDate === reopenTargetDate &&
      run.status !== "reverted"
    );
    let runToRevert = candidateRunToRevert;
    if (runToRevert && dataOwnerUserId) {
      const [cloudSnapshots, cloudLateFeeEntryIds] = await Promise.all([
        Array.isArray(runToRevert.clientSnapshots) && runToRevert.clientSnapshots.length > 0
          ? Promise.resolve(runToRevert.clientSnapshots)
          : loadCloudChargeRunSnapshots(dataOwnerUserId, runToRevert.id),
        Array.isArray(runToRevert.lateFeeEntryIds) && runToRevert.lateFeeEntryIds.length > 0
          ? Promise.resolve(runToRevert.lateFeeEntryIds)
          : loadCloudChargeRunLateFeeEntryIds(dataOwnerUserId, runToRevert.id)
      ]);
      runToRevert = {
        ...runToRevert,
        clientSnapshots: cloudSnapshots,
        lateFeeEntryIds: cloudLateFeeEntryIds
      };
    }
    const legacyRun = runToRevert && (!Array.isArray(runToRevert.clientSnapshots) || runToRevert.clientSnapshots.length === 0)
      ? runToRevert
      : undefined;
    if (legacyRun) {
      setCashClosingError(
        `La caja de ${reopenTargetDate} no tiene snapshot financiero disponible. No se puede reabrir automaticamente sin riesgo de alterar balances.`
      );
      setCashClosingInfo("");
      return;
    }

    let revertedClients = clients;
    let rollbackCount = 0;
    let nextRuns = chargeRuns;
    if (runToRevert?.clientSnapshots?.length) {
      const snapshotsByClient = new Map(runToRevert.clientSnapshots.map((snapshot) => [snapshot.clientId, snapshot]));
      revertedClients = clients.map((client) => {
        const snapshot = snapshotsByClient.get(client.id);
        if (!snapshot) return client;
        rollbackCount += 1;
        return {
          ...client,
          balance: snapshot.before.balance,
          advanceBalance: snapshot.before.advanceBalance ?? 0,
          lastChargeDate: snapshot.before.lastChargeDate,
          firstSundayChargedAt: snapshot.before.firstSundayChargedAt,
          installmentsIssued: snapshot.before.installmentsIssued,
          installmentsIssuedEstimateNeedsReview: snapshot.before.installmentsIssuedEstimateNeedsReview,
          otherCharges: snapshot.before.otherCharges ? snapshot.before.otherCharges.map((charge) => ({ ...charge })) : [],
          activeProvisionalRental: snapshot.before.activeProvisionalRental
        };
      });
      await onClientsChange(revertedClients);
      const lateFeeIds = new Set(runToRevert.lateFeeEntryIds ?? []);
      if (lateFeeIds.size > 0) {
        const nextLedger = lateFeeLedger.filter((entry) => !lateFeeIds.has(entry.id));
        setLateFeeLedger(nextLedger);
        saveLateFeeLedger(nextLedger);
      }
      nextRuns = chargeRuns.map((run) =>
        run.id === runToRevert.id
          ? {
              ...run,
              status: "reverted",
              revertedAt: new Date().toISOString(),
              revertedReason: reason,
              revertedBy: actor
            }
          : run
      );
      await persistChargeRuns(nextRuns);
    } else {
      const feesFromDate = lateFeeLedger.filter((entry) => entry.date === reopenTargetDate);
      if (feesFromDate.length > 0) {
        const entriesByClient = new Map<string, LateFeeLedgerEntry[]>();
        for (const entry of feesFromDate) {
          const rows = entriesByClient.get(entry.clientId) ?? [];
          rows.push(entry);
          entriesByClient.set(entry.clientId, rows);
        }
        revertedClients = clients.map((client) => {
          const entries = entriesByClient.get(client.id);
          if (!entries || entries.length === 0) return client;
          let otherCharges = [...(client.otherCharges ?? [])];
          for (const entry of entries) {
            otherCharges = subtractOtherCharge(otherCharges, entry.chargeLabel, entry.amount);
          }
          return { ...client, otherCharges };
        });
        await onClientsChange(revertedClients);
        const nextLedger = lateFeeLedger.filter((entry) => entry.date !== reopenTargetDate);
        setLateFeeLedger(nextLedger);
        saveLateFeeLedger(nextLedger);
        rollbackCount = feesFromDate.length;
      }
    }

    const nextClosings = cashClosings.filter((c) => c.date !== reopenTargetDate);
    await persistCashClosings(nextClosings);

    const event: CashClosingAuditEvent = {
      id: crypto.randomUUID(),
      date: reopenTargetDate,
      action: "reopen",
      actor,
      reason,
      createdAt: new Date().toISOString()
    };
    const nextAudit = [event, ...cashClosingAudit].slice(0, 300);
    await persistCashClosingAudit(nextAudit);

    setCashClosingInfo(
      runToRevert
        ? `Caja reabierta para ${reopenTargetDate}. Se restauraron ${rollbackCount} cliente(s) al estado previo del cierre.`
        : rollbackCount > 0
          ? `Caja reabierta para ${reopenTargetDate}. Se reversaron ${rollbackCount} recargo(s) de mora de esa fecha.`
          : `Caja reabierta para ${reopenTargetDate}.`
    );
    setCashClosingError("");
    setReopenTargetDate(null);
    setReopenReason("");
  } catch (error) {
    console.error("No se pudo reabrir caja.", error);
    const message = error instanceof Error ? error.message : "No se pudo reabrir caja.";
    setCashClosingError(`Reapertura no completada: ${message}`);
    setCashClosingInfo("");
    await loadCashClosingCloudState(dataOwnerUserId).catch(() => undefined);
  } finally {
    setIsClosingCash(false);
  }
}

  return {
    cashClosings,
    cashClosingDate,
    setCashClosingDate,
    cashClosingActor,
    setCashClosingActor,
    cashClosingInfo,
    cashClosingError,
    cashClosingAudit,
    chargeRuns,
    lastCloseReport,
    isClosingCash,
    reopenTargetDate,
    setReopenTargetDate,
    reopenReason,
    setReopenReason,
    operationalDateKey,
    isDateClosed,
    handleCloseCashForDate,
    openReopenDialog,
    handleConfirmReopen
  };
}
