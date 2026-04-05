import { normalizeBankSearch } from "../csv";
import type { BankRow, Client, ClientState, Movement } from "../types";
import { getTodayIsoDate } from "../app/constants";
import { parseDateValue } from "./format";

export interface ClientMetrics {
  balance: number;
  lastPaymentDate: string | null;
  state: ClientState;
}

export type ClientMetricsById = Record<string, ClientMetrics>;

function compareDatesDesc(left: string, right: string) {
  return right.localeCompare(left);
}

function getClientState(balance: number, lastPaymentDate: string | null, today: string): ClientState {
  if (balance <= 0) {
    return "al-dia";
  }

  if (!lastPaymentDate) {
    return "atrasado";
  }

  const paymentDate = parseDateValue(lastPaymentDate);
  const now = parseDateValue(today);

  if (!paymentDate || !now) {
    return balance > 500 ? "atrasado" : "pendiente";
  }

  const msDiff = now.getTime() - paymentDate.getTime();
  const dayDiff = Math.floor(msDiff / (1000 * 60 * 60 * 24));

  if (balance > 500 || dayDiff > 25) {
    return "atrasado";
  }

  return "pendiente";
}

export function getMovementImpact(movement: Movement) {
  if (movement.type === "cargo") {
    return movement.amount;
  }

  if (movement.type === "abono") {
    return -Math.abs(movement.amount);
  }

  return movement.amount;
}

export function buildClientMetrics(
  clients: Client[],
  movements: Movement[],
  today = getTodayIsoDate(),
) {
  const metricsById: ClientMetricsById = {};

  for (const client of clients) {
    metricsById[client.id] = {
      balance: 0,
      lastPaymentDate: null,
      state: "al-dia",
    };
  }

  for (const movement of movements) {
    const currentMetrics = metricsById[movement.clientId];

    if (!currentMetrics) {
      continue;
    }

    currentMetrics.balance += getMovementImpact(movement);

    if (
      movement.type === "abono" &&
      (!currentMetrics.lastPaymentDate || movement.date > currentMetrics.lastPaymentDate)
    ) {
      currentMetrics.lastPaymentDate = movement.date;
    }
  }

  for (const client of clients) {
    const currentMetrics = metricsById[client.id];
    currentMetrics.state = getClientState(
      currentMetrics.balance,
      currentMetrics.lastPaymentDate,
      today,
    );
  }

  return metricsById;
}

export function filterAndSortClients(
  clients: Client[],
  search: string,
  metricsById: ClientMetricsById,
) {
  const normalizedSearch = normalizeBankSearch(search);
  const visibleClients = normalizedSearch
    ? clients.filter((client) => {
        const haystack = [client.code, client.name, client.alias, client.phone].join(" ");
        return normalizeBankSearch(haystack).includes(normalizedSearch);
      })
    : clients;

  return [...visibleClients].sort((left, right) => {
    const leftBalance = metricsById[left.id]?.balance ?? 0;
    const rightBalance = metricsById[right.id]?.balance ?? 0;
    return rightBalance - leftBalance;
  });
}

export function getClientMovements(clientId: string, movements: Movement[]) {
  return movements
    .filter((movement) => movement.clientId === clientId)
    .sort((left, right) => compareDatesDesc(left.date, right.date));
}

export function buildOverview(
  metricsById: ClientMetricsById,
  movements: Movement[],
  bankRows: BankRow[],
  today = getTodayIsoDate(),
) {
  const metricsList = Object.values(metricsById);
  const currentMonth = today.slice(0, 7);
  const monthPayments = movements.filter(
    (movement) => movement.type === "abono" && movement.date.startsWith(currentMonth),
  );

  return {
    totalPending: metricsList.reduce((sum, item) => sum + Math.max(item.balance, 0), 0),
    totalClientsWithDebt: metricsList.filter((item) => item.balance > 0).length,
    totalMonthPayments: monthPayments.reduce((sum, movement) => sum + movement.amount, 0),
    monthPaymentsCount: monthPayments.length,
    pendingBankRows: bankRows.filter((row) => row.status !== "procesado").length,
  };
}
