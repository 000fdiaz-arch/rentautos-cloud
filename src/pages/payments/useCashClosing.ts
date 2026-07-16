import { useEffect, useMemo, useState } from "react";
import { getBusinessDateKey, isChargeDay, parseDateKey, startOfDay, toDateKey } from "../../billing";
import {
  loadCloudCashClosingAudit,
  loadCloudCashClosings,
  loadCloudChargeRuns,
  saveCloudCashClosingAudit,
  saveCloudCashClosings,
  saveCloudChargeRuns
} from "../../cloudData";
import { formatCurrency } from "../../format";
import { applyLateFeesForClosingDate, subtractOtherCharge } from "../../lateFees";
import { supabase } from "../../lib/supabase";
import { buildReceivableRows } from "../../receivables";
import { loadLateFeeLedger, saveLateFeeLedger } from "../../storage";
import type { Client, LateFeeLedgerEntry, LateFeeSettings, Payment } from "../../types";
import { loadCashSummaryRange } from "../../cashLedger";
import {
  COLLECTION_CLOSURES_KEY,
  COLLECTION_STATUS_KEY
} from "./paymentConstants";
import {
  resolveCollectionStatusForClosure,
  roundMoney
} from "./paymentRules";
import {
  loadCashClosingAudit,
  loadCashClosings,
  loadChargeRuns,
  loadCollectionClosuresFromStorage,
  parseCollectionStatusesFromStorage,
  saveCashClosingAudit,
  saveCashClosings,
  saveChargeRuns
} from "./paymentStorage";
import type {
  CashClosing,
  CashClosingAuditEvent,
  ChargeApplyResult,
  ChargeCloseReport,
  ChargeReportRow,
  ChargeRun,
  CollectionClosureItem,
  CollectionClosureSnapshot,
  CollectionStatus
} from "./paymentTypes";

type Options = {
  clients: Client[];
  payments: Payment[];
  lateFeeSettings: LateFeeSettings;
  onClientsChange: (next: Client[]) => void;
  onCashClose?: () => void;
  dataOwnerUserId?: string | null;
};

export default function useCashClosing({
  clients,
  payments,
  lateFeeSettings,
  onClientsChange,
  onCashClose,
  dataOwnerUserId
}: Options) {
  const [cashClosings, setCashClosings] = useState<CashClosing[]>(() => loadCashClosings());
  const [cashClosingDate, setCashClosingDate] = useState<string>(getBusinessDateKey());
  const [cashClosingActor, setCashClosingActor] = useState<string>("Operador");
  const [cashClosingInfo, setCashClosingInfo] = useState<string>("");
  const [cashClosingError, setCashClosingError] = useState<string>("");
  const [cashClosingAudit, setCashClosingAudit] = useState<CashClosingAuditEvent[]>(() => loadCashClosingAudit());
  const [chargeRuns, setChargeRuns] = useState<ChargeRun[]>(() => loadChargeRuns());
  const [lateFeeLedger, setLateFeeLedger] = useState<LateFeeLedgerEntry[]>(() => loadLateFeeLedger());
  const [lastCloseReport, setLastCloseReport] = useState<ChargeCloseReport | null>(null);
  const [reopenTargetDate, setReopenTargetDate] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState<string>("");
  const [cashLedgerClosedDates, setCashLedgerClosedDates] = useState<string[]>([]);

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
    const normalizedClosings = cloudClosings
      .filter((closing) => typeof closing.date === "string" && typeof closing.closedAt === "string")
      .sort((a, b) => b.date.localeCompare(a.date));
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
    saveCashClosings(normalizedClosings);
    saveCashClosingAudit(normalizedAudit);
    saveChargeRuns(normalizedRuns);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_day_closings", filter: `owner_user_id=eq.${dataOwnerUserId}` }, scheduleReload)
      .subscribe();
    return () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

  function persistCashClosings(next: CashClosing[]): void {
    setCashClosings(next);
    saveCashClosings(next);
    if (dataOwnerUserId) {
      void saveCloudCashClosings(dataOwnerUserId, next).catch((error) => {
        console.error("No se pudieron guardar cierres en nube.", error);
        setCashClosingError("No se pudo guardar el cierre en nube. Verifica conexion y actualiza.");
      });
    }
  }

  function persistCashClosingAudit(next: CashClosingAuditEvent[]): void {
    setCashClosingAudit(next);
    saveCashClosingAudit(next);
    if (dataOwnerUserId) {
      void saveCloudCashClosingAudit(dataOwnerUserId, next).catch((error) => {
        console.error("No se pudo guardar auditoria de cierre en nube.", error);
      });
    }
  }

  function persistChargeRuns(next: ChargeRun[]): void {
    setChargeRuns(next);
    saveChargeRuns(next);
    if (dataOwnerUserId) {
      void saveCloudChargeRuns(dataOwnerUserId, next).catch((error) => {
        console.error("No se pudieron guardar cargos de cierre en nube.", error);
      });
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
    if (candidates.length === 0) return today;
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

function getChargeTargetDateKey(closingDateKey: string): string | null {
  const closingDate = parseDateKey(closingDateKey);
  if (!closingDate) return null;
  const targetDate = new Date(closingDate);
  targetDate.setDate(targetDate.getDate() + 1);
  return toDateKey(targetDate);
}

function hasChargeRunForClosing(closingDateKey: string): boolean {
  const targetDateKey = getChargeTargetDateKey(closingDateKey);
  if (!targetDateKey) return false;
  return chargeRuns.some((run) => run.targetDate === targetDateKey);
}

function applyNextDayChargesFromClosing(
  closingDateKey: string,
  options: { repairExistingRun?: boolean; forceIncompleteZeroRun?: boolean } = {}
): ChargeApplyResult {
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
      rows: []
    };
  }
  const targetDate = new Date(closingDate);
  targetDate.setDate(targetDate.getDate() + 1);
  const targetDateKey = toDateKey(targetDate);
  const existingRun = chargeRuns.find((r) => r.targetDate === targetDateKey);
  const alreadyProcessed = !!existingRun;
  const shouldForceIncompleteZeroRun = !!(
    options.forceIncompleteZeroRun &&
    existingRun &&
    existingRun.chargedClients === 0 &&
    roundMoney(existingRun.chargedTotal) === 0
  );

  const lateFeeResult = applyLateFeesForClosingDate({
    clients,
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
    if (newLateFeeEntries.length > 0) {
      const nextLedger = [...newLateFeeEntries, ...lateFeeLedger].slice(0, 10000);
      setLateFeeLedger(nextLedger);
      saveLateFeeLedger(nextLedger);
      onClientsChange(clientsWithLateFees);
    }
    return {
      targetDate: targetDateKey,
      alreadyProcessed: true,
      expectedClients: 0,
      chargedClients: 0,
      anomalyClients: 0,
      chargedTotal: 0,
      lateFeeClients,
      lateFeeTotal,
      rows: []
    };
  }

  let expectedClients = 0;
  let chargedClients = 0;
  let anomalyClients = 0;
  let chargedTotal = 0;
  const rows: ChargeReportRow[] = [];
  const nextClients = clientsWithLateFees.map((client) => {
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
    const canCharge = Number.isFinite(client.rentAmount) && client.rentAmount > 0;
    const shouldChargeByRule = canCharge && isChargeDay(client, targetDate);
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
      blockingError: `No se pudo cerrar: ${anomalyClients} cliente(s) tenian estado inconsistente para ${targetDateKey}.`
    };
  }

  if (newLateFeeEntries.length > 0) {
    const nextLedger = [...newLateFeeEntries, ...lateFeeLedger].slice(0, 10000);
    setLateFeeLedger(nextLedger);
    saveLateFeeLedger(nextLedger);
  }

  onClientsChange(nextClients);

  const run: ChargeRun = {
    id: crypto.randomUUID(),
    closingDate: closingDateKey,
    targetDate: targetDateKey,
    expectedClients,
    chargedClients,
    anomalyClients,
    chargedTotal,
    createdAt: new Date().toISOString()
  };
  const remainingRuns = options.repairExistingRun
    ? chargeRuns.filter((item) => item.targetDate !== targetDateKey)
    : chargeRuns;
  const nextRuns = [run, ...remainingRuns].slice(0, 400);
  persistChargeRuns(nextRuns);

  return {
    targetDate: targetDateKey,
    alreadyProcessed,
    expectedClients,
    chargedClients,
    anomalyClients,
    chargedTotal,
    lateFeeClients,
    lateFeeTotal,
    rows
  };
}

function handleCloseCashForDate(): void {
  const date = cashClosingDate.trim();
  const actor = cashClosingActor.trim() || "Operador";
  const reason = "Cierre diario";
  if (!dataOwnerUserId) {
    setCashClosingError("No se puede cerrar caja sin conexion a la nube del negocio. Actualiza e intenta de nuevo.");
    setCashClosingInfo("");
    return;
  }
  if (!date) {
    setCashClosingError("Debes seleccionar una fecha para cerrar caja.");
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

  const chargeResult = applyNextDayChargesFromClosing(date);
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

  const closing: CashClosing = { date, closedAt: new Date().toISOString() };
  const nextClosings = [...cashClosings, closing].sort((a, b) => b.date.localeCompare(a.date));
  persistCashClosings(nextClosings);

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
  persistCashClosingAudit(nextAudit);

  // Snapshot final de gestion de cobros para consulta historica y bloqueo del dia cerrado.
  const closureDateRef = parseDateKey(date) ?? startOfDay(new Date());
  const receivableRows = buildReceivableRows(clients, payments, closureDateRef);
  const statusesByClient = parseCollectionStatusesFromStorage();
  const closureTotals: Record<CollectionStatus, number> = {
    no_answer: 0,
    reminder: 0,
    call_later: 0,
    paid: 0
  };
  const closureItems: CollectionClosureItem[] = receivableRows.map((row) => {
    const resolved = resolveCollectionStatusForClosure(row, statusesByClient, date);
    closureTotals[resolved.status] += 1;
    return {
      clientId: row.id,
      unitId: row.unitId,
      clientName: row.name,
      lastPaymentDate: row.lastPaymentDate,
      receivableState: row.state,
      totalPending: row.totalPending,
      collectionStatus: resolved.status,
      comment: resolved.comment,
      autoApplied: resolved.autoApplied
    };
  });
  const collectionClosureSnapshot: CollectionClosureSnapshot = {
    date,
    closedAt: new Date().toISOString(),
    actor,
    reason,
    totals: closureTotals,
    items: closureItems
  };
  const existingClosures = loadCollectionClosuresFromStorage();
  localStorage.setItem(
    COLLECTION_CLOSURES_KEY,
    JSON.stringify({
      ...existingClosures,
      [date]: collectionClosureSnapshot
    })
  );
  // Reinicia la gestion activa despues del cierre para arrancar el siguiente ciclo en estado base.
  localStorage.setItem(COLLECTION_STATUS_KEY, JSON.stringify({}));

  const chargeInfo = chargeResult.alreadyProcessed
    ? `Cobros de ${chargeResult.targetDate} ya estaban aplicados previamente.`
    : `Cobros aplicados para ${chargeResult.targetDate}: esperados ${chargeResult.expectedClients}, cobrados ${chargeResult.chargedClients}, total ${formatCurrency(chargeResult.chargedTotal)}.`;
  const lateFeeInfo = chargeResult.lateFeeClients > 0
    ? ` Recargos por tardanza: ${chargeResult.lateFeeClients} cliente(s), total ${formatCurrency(chargeResult.lateFeeTotal)}.`
    : "";
  setCashClosingError("");
  setCashClosingInfo(
    `Caja cerrada para ${date}. Pagos del dia: ${paymentsOfDay.length}. Total del dia: ${formatCurrency(dayTotal)}. ${chargeInfo}${lateFeeInfo}`
  );
  onCashClose?.();
}

function openReopenDialog(date: string): void {
  setReopenTargetDate(date);
  setReopenReason("");
  setCashClosingError("");
}

function handleConfirmReopen(): void {
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

  const nextClosings = cashClosings.filter((c) => c.date !== reopenTargetDate);
  persistCashClosings(nextClosings);

  const feesFromDate = lateFeeLedger.filter((entry) => entry.date === reopenTargetDate);
  if (feesFromDate.length > 0) {
    const entriesByClient = new Map<string, LateFeeLedgerEntry[]>();
    for (const entry of feesFromDate) {
      const rows = entriesByClient.get(entry.clientId) ?? [];
      rows.push(entry);
      entriesByClient.set(entry.clientId, rows);
    }
    const revertedClients = clients.map((client) => {
      const entries = entriesByClient.get(client.id);
      if (!entries || entries.length === 0) return client;
      let otherCharges = [...(client.otherCharges ?? [])];
      for (const entry of entries) {
        otherCharges = subtractOtherCharge(otherCharges, entry.chargeLabel, entry.amount);
      }
      return { ...client, otherCharges };
    });
    onClientsChange(revertedClients);
    const nextLedger = lateFeeLedger.filter((entry) => entry.date !== reopenTargetDate);
    setLateFeeLedger(nextLedger);
    saveLateFeeLedger(nextLedger);
  }

  const event: CashClosingAuditEvent = {
    id: crypto.randomUUID(),
    date: reopenTargetDate,
    action: "reopen",
    actor,
    reason,
    createdAt: new Date().toISOString()
  };
  const nextAudit = [event, ...cashClosingAudit].slice(0, 300);
  persistCashClosingAudit(nextAudit);

  const rollbackCount = lateFeeLedger.filter((entry) => entry.date === reopenTargetDate).length;
  setCashClosingInfo(
    rollbackCount > 0
      ? `Caja reabierta para ${reopenTargetDate}. Se reversaron ${rollbackCount} recargo(s) de mora de esa fecha.`
      : `Caja reabierta para ${reopenTargetDate}.`
  );
  setCashClosingError("");
  setReopenTargetDate(null);
  setReopenReason("");
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
