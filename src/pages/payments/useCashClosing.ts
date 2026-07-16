import { useEffect, useMemo, useState } from "react";
import { getBusinessDateKey, isChargeDay, parseDateKey, startOfDay, toDateKey } from "../../billing";
import { formatCurrency } from "../../format";
import { applyLateFeesForClosingDate, subtractOtherCharge } from "../../lateFees";
import { buildReceivableRows } from "../../receivables";
import { loadLateFeeLedger, saveLateFeeLedger } from "../../storage";
import type { Client, LateFeeLedgerEntry, LateFeeSettings, Payment } from "../../types";
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
};

export default function useCashClosing({
  clients,
  payments,
  lateFeeSettings,
  onClientsChange,
  onCashClose
}: Options) {
  const [cashClosings, setCashClosings] = useState<CashClosing[]>(() => loadCashClosings());
  const [cashClosingDate, setCashClosingDate] = useState<string>(getBusinessDateKey());
  const [cashClosingActor, setCashClosingActor] = useState<string>("Operador");
  const [cashClosingReason, setCashClosingReason] = useState<string>("");
  const [cashClosingInfo, setCashClosingInfo] = useState<string>("");
  const [cashClosingError, setCashClosingError] = useState<string>("");
  const [cashClosingAudit, setCashClosingAudit] = useState<CashClosingAuditEvent[]>(() => loadCashClosingAudit());
  const [chargeRuns, setChargeRuns] = useState<ChargeRun[]>(() => loadChargeRuns());
  const [lateFeeLedger, setLateFeeLedger] = useState<LateFeeLedgerEntry[]>(() => loadLateFeeLedger());
  const [lastCloseReport, setLastCloseReport] = useState<ChargeCloseReport | null>(null);
  const [reopenTargetDate, setReopenTargetDate] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState<string>("");

  const closedDateSet = useMemo(
    () => new Set(cashClosings.map((closing) => closing.date)),
    [cashClosings]
  );

  const nextUnclosedDateKey = useMemo(() => {
    const today = getBusinessDateKey();
    const candidates = cashClosings.map((closing) => closing.date.trim()).filter((date) => date.length > 0);
    if (candidates.length === 0) return today;
    const sortedClosedDates = [...new Set(candidates)].sort();
    const latestClosed = sortedClosedDates[sortedClosedDates.length - 1];
    if (!latestClosed) return today;
    const latestClosedDate = parseDateKey(latestClosed);
    if (!latestClosedDate) return today;
    const nextOperational = new Date(latestClosedDate);
    nextOperational.setDate(nextOperational.getDate() + 1);
    return toDateKey(nextOperational);
  }, [cashClosings]);

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
  setChargeRuns(nextRuns);
  saveChargeRuns(nextRuns);

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
  const reason = cashClosingReason.trim();
  if (!date) {
    setCashClosingError("Debes seleccionar una fecha para cerrar caja.");
    setCashClosingInfo("");
    return;
  }
  if (!reason) {
    setCashClosingError("Debes indicar un motivo para cerrar caja.");
    setCashClosingInfo("");
    return;
  }
  if (isDateClosed(date)) {
    const hadExistingRun = hasChargeRunForClosing(date);
    const chargeResult = applyNextDayChargesFromClosing(date, {
      repairExistingRun: true,
      forceIncompleteZeroRun: true
    });
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

    const chargeInfo = hadExistingRun && chargeResult.chargedClients === 0
      ? `Cobros revisados para ${chargeResult.targetDate}: no habia cargos nuevos pendientes. Esperados ${chargeResult.expectedClients}.`
      : `Cobros reparados para ${chargeResult.targetDate}: esperados ${chargeResult.expectedClients}, cobrados ${chargeResult.chargedClients}, total ${formatCurrency(chargeResult.chargedTotal)}.`;
    const lateFeeInfo = chargeResult.lateFeeClients > 0
      ? ` Recargos por tardanza: ${chargeResult.lateFeeClients} cliente(s), total ${formatCurrency(chargeResult.lateFeeTotal)}.`
      : "";
    setCashClosingError("");
    setCashClosingInfo(`La caja de ${date} ya estaba cerrada. ${chargeInfo}${lateFeeInfo}`);
    onCashClose?.();
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
  setCashClosings(nextClosings);
  saveCashClosings(nextClosings);

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
  setCashClosingAudit(nextAudit);
  saveCashClosingAudit(nextAudit);

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
  setCashClosingReason("");
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
  setCashClosings(nextClosings);
  saveCashClosings(nextClosings);

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
  setCashClosingAudit(nextAudit);
  saveCashClosingAudit(nextAudit);

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
    cashClosingReason,
    setCashClosingReason,
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
