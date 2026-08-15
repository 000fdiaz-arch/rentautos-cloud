import type {
  Client,
  Payment,
  ProvisionalRental,
  ProvisionalRentalCharge,
  ProvisionalRentalFrequency
} from "./types";

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function roundRentalMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function intervalDays(frequency: ProvisionalRentalFrequency): number {
  if (frequency === "weekly") return 7;
  if (frequency === "biweekly") return 14;
  return 1;
}

export function createProvisionalRental(input: {
  client: Client;
  unitId: string;
  brandModel?: string;
  plate?: string;
  frequency: ProvisionalRentalFrequency;
  rentAmount: number;
  startDate: string;
  now?: string;
  initialCredit?: number;
}): ProvisionalRental {
  const now = input.now ?? new Date().toISOString();
  const rental: ProvisionalRental = {
    id: crypto.randomUUID(),
    clientId: input.client.id,
    regularUnitId: input.client.unitId,
    unitId: input.unitId.trim().toUpperCase(),
    brandModel: input.brandModel?.trim() || undefined,
    plate: input.plate?.trim().toUpperCase() || undefined,
    frequency: input.frequency,
    rentAmount: roundRentalMoney(input.rentAmount),
    startDate: input.startDate,
    status: "active",
    balance: 0,
    creditBalance: roundRentalMoney(Math.max(0, input.initialCredit ?? 0)),
    charges: [],
    createdAt: now,
    updatedAt: now
  };
  return accrueProvisionalRental(rental, input.startDate);
}

export function collectReturnedProvisionalRentalCredit(client: Client): { credit: number; history: ProvisionalRental[] } {
  let credit = 0;
  const history = (client.provisionalRentalHistory ?? []).map((rental) => {
    if (rental.status !== "returned" || rental.balance > 0 || rental.creditBalance <= 0) return rental;
    credit = roundRentalMoney(credit + rental.creditBalance);
    return { ...rental, creditBalance: 0, updatedAt: new Date().toISOString() };
  });
  return { credit, history };
}

export function accrueProvisionalRental(rental: ProvisionalRental, throughDateKey: string): ProvisionalRental {
  if (rental.status !== "active") return rental;
  const throughDate = parseDateKey(throughDateKey);
  const startDate = parseDateKey(rental.startDate);
  if (!throughDate || !startDate || throughDate < startDate) return rental;

  const existingDates = new Set((rental.charges ?? []).map((charge) => charge.dueDate));
  const charges: ProvisionalRentalCharge[] = [...(rental.charges ?? [])];
  const step = intervalDays(rental.frequency);
  let cursor = rental.nextChargeDate ? (parseDateKey(rental.nextChargeDate) ?? startDate) : startDate;
  for (; cursor <= throughDate; cursor = addCalendarDays(cursor, step)) {
    const dueDate = toDateKey(cursor);
    if (existingDates.has(dueDate)) continue;
    charges.push({
      id: crypto.randomUUID(),
      dueDate,
      amount: roundRentalMoney(rental.rentAmount),
      amountPaid: 0
    });
  }
  charges.sort((left, right) => left.dueDate.localeCompare(right.dueDate));

  let credit = roundRentalMoney(Math.max(0, rental.creditBalance ?? 0));
  const creditedCharges = charges.map((charge) => {
    const pending = roundRentalMoney(Math.max(0, charge.amount - charge.amountPaid));
    const applied = roundRentalMoney(Math.min(credit, pending));
    credit = roundRentalMoney(credit - applied);
    return applied > 0 ? { ...charge, amountPaid: roundRentalMoney(charge.amountPaid + applied) } : charge;
  });
  const balance = roundRentalMoney(creditedCharges.reduce(
    (sum, charge) => sum + Math.max(0, charge.amount - charge.amountPaid),
    0
  ));
  return {
    ...rental,
    charges: creditedCharges,
    balance,
    creditBalance: credit,
    lastChargeDate: throughDateKey,
    nextChargeDate: toDateKey(cursor),
    updatedAt: new Date().toISOString()
  };
}

export function accrueClientProvisionalRental(client: Client, throughDateKey: string): Client {
  if (!client.activeProvisionalRental) return client;
  const activeProvisionalRental = accrueProvisionalRental(client.activeProvisionalRental, throughDateKey);
  return activeProvisionalRental === client.activeProvisionalRental
    ? client
    : { ...client, activeProvisionalRental };
}

export function getOutstandingReturnedRental(client: Client): ProvisionalRental | undefined {
  return [...(client.provisionalRentalHistory ?? [])]
    .filter((rental) => rental.status === "returned" && rental.balance > 0)
    .sort((left, right) => left.startDate.localeCompare(right.startDate))[0];
}

export function getCollectibleProvisionalRental(client: Client): ProvisionalRental | undefined {
  return client.activeProvisionalRental ?? getOutstandingReturnedRental(client);
}

export function hasOutstandingProvisionalRentalDebt(client: Client): boolean {
  return Boolean(getOutstandingReturnedRental(client));
}

export function updateActiveProvisionalRentalTerms(
  client: Client,
  frequency: ProvisionalRentalFrequency,
  rentAmount: number,
  effectiveDateKey: string
): Client {
  if (!client.activeProvisionalRental) return client;
  const accrued = accrueProvisionalRental(client.activeProvisionalRental, effectiveDateKey);
  const effectiveDate = parseDateKey(effectiveDateKey);
  const nextChargeDate = effectiveDate
    ? toDateKey(addCalendarDays(effectiveDate, intervalDays(frequency)))
    : accrued.nextChargeDate;
  const now = new Date().toISOString();
  return {
    ...client,
    activeProvisionalRental: {
      ...accrued,
      frequency,
      rentAmount: roundRentalMoney(rentAmount),
      nextChargeDate,
      rateChanges: [...(accrued.rateChanges ?? []), {
        id: crypto.randomUUID(),
        changedAt: now,
        previousFrequency: accrued.frequency,
        nextFrequency: frequency,
        previousAmount: accrued.rentAmount,
        nextAmount: roundRentalMoney(rentAmount)
      }],
      updatedAt: now
    }
  };
}

export function returnActiveProvisionalRental(client: Client, returnDateKey: string): Client {
  if (!client.activeProvisionalRental) return client;
  const accrued = accrueProvisionalRental(client.activeProvisionalRental, returnDateKey);
  const returned: ProvisionalRental = {
    ...accrued,
    status: "returned",
    returnedAt: new Date().toISOString(),
    nextChargeDate: undefined,
    updatedAt: new Date().toISOString()
  };
  return {
    ...client,
    activeProvisionalRental: undefined,
    provisionalRentalHistory: [...(client.provisionalRentalHistory ?? []), returned],
    // Evita que el motor regular recupere cargos del periodo congelado.
    lastChargeDate: returnDateKey
  };
}

export function cancelActiveProvisionalRental(client: Client): Client {
  if (!client.activeProvisionalRental) return client;
  const now = new Date().toISOString();
  const cancelled: ProvisionalRental = {
    ...client.activeProvisionalRental,
    status: "cancelled",
    balance: 0,
    creditBalance: 0,
    charges: [],
    cancelledAt: now,
    nextChargeDate: undefined,
    updatedAt: now
  };
  return {
    ...client,
    activeProvisionalRental: undefined,
    provisionalRentalHistory: [...(client.provisionalRentalHistory ?? []), cancelled]
  };
}

export type ProvisionalRentalPaymentAllocation = {
  rental: ProvisionalRental;
  balanceBefore: number;
  balanceAfter: number;
  creditAfter: number;
  amountApplied: number;
  chargeApplications: Array<{
    chargeId: string;
    dueDate: string;
    amount: number;
    chargeAmount: number;
    paidAfter: number;
  }>;
};

export function applyPaymentToProvisionalRental(
  rentalInput: ProvisionalRental,
  wholeAmount: number,
  paymentDateKey: string
): ProvisionalRentalPaymentAllocation {
  const rental = rentalInput.status === "active"
    ? accrueProvisionalRental(rentalInput, paymentDateKey)
    : rentalInput;
  const balanceBefore = roundRentalMoney(Math.max(0, rental.balance));
  let remaining = roundRentalMoney(Math.max(0, wholeAmount));
  const applications: ProvisionalRentalPaymentAllocation["chargeApplications"] = [];
  const charges = rental.charges.map((charge) => {
    const pending = roundRentalMoney(Math.max(0, charge.amount - charge.amountPaid));
    const amount = roundRentalMoney(Math.min(remaining, pending));
    if (amount <= 0) return charge;
    remaining = roundRentalMoney(remaining - amount);
    const paidAfter = roundRentalMoney(charge.amountPaid + amount);
    applications.push({
      chargeId: charge.id,
      dueDate: charge.dueDate,
      amount,
      chargeAmount: charge.amount,
      paidAfter
    });
    return { ...charge, amountPaid: paidAfter };
  });
  const balanceAfter = roundRentalMoney(charges.reduce(
    (sum, charge) => sum + Math.max(0, charge.amount - charge.amountPaid),
    0
  ));
  const creditAfter = roundRentalMoney(Math.max(0, (rental.creditBalance ?? 0) + remaining));
  return {
    rental: {
      ...rental,
      charges,
      balance: balanceAfter,
      creditBalance: creditAfter,
      updatedAt: new Date().toISOString()
    },
    balanceBefore,
    balanceAfter,
    creditAfter,
    amountApplied: roundRentalMoney(Math.max(0, wholeAmount - remaining)),
    chargeApplications: applications
  };
}

export function replaceCollectibleRental(client: Client, rental: ProvisionalRental): Client {
  if (client.activeProvisionalRental?.id === rental.id) {
    return { ...client, activeProvisionalRental: rental };
  }
  return {
    ...client,
    provisionalRentalHistory: (client.provisionalRentalHistory ?? []).map((item) => item.id === rental.id ? rental : item)
  };
}

export function restoreProvisionalRentalPayment(client: Client, payment: Payment): Client {
  if (payment.paymentContext !== "provisional_rental" || !payment.provisionalRentalId) return client;
  const reverse = (rental: ProvisionalRental): ProvisionalRental => {
    if (rental.id !== payment.provisionalRentalId) return rental;
    const applications = new Map((payment.provisionalRentalChargesApplied ?? []).map((item) => [item.chargeId, item.amount]));
    const charges = rental.charges.map((charge) => ({
      ...charge,
      amountPaid: roundRentalMoney(Math.max(0, charge.amountPaid - (applications.get(charge.id) ?? 0)))
    }));
    const wholePaid = roundRentalMoney(Math.max(0, payment.amountReceived - payment.centavosAhorro));
    const applied = roundRentalMoney((payment.provisionalRentalChargesApplied ?? []).reduce((sum, item) => sum + item.amount, 0));
    const creditReversed = roundRentalMoney(Math.max(0, wholePaid - applied));
    return {
      ...rental,
      charges,
      balance: roundRentalMoney(charges.reduce((sum, charge) => sum + Math.max(0, charge.amount - charge.amountPaid), 0)),
      creditBalance: roundRentalMoney(Math.max(0, rental.creditBalance - creditReversed)),
      updatedAt: new Date().toISOString()
    };
  };
  return {
    ...client,
    activeProvisionalRental: client.activeProvisionalRental ? reverse(client.activeProvisionalRental) : undefined,
    provisionalRentalHistory: (client.provisionalRentalHistory ?? []).map(reverse),
    savings: roundRentalMoney(Math.max(0, client.savings - payment.centavosAhorro))
  };
}

export function nextProvisionalRentalChargeDate(rental: ProvisionalRental): string | null {
  if (rental.status !== "active") return null;
  const oldestPendingCharge = [...rental.charges]
    .filter((charge) => roundRentalMoney(Math.max(0, charge.amount - charge.amountPaid)) > 0)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
  if (oldestPendingCharge) return oldestPendingCharge.dueDate;
  if (rental.nextChargeDate) return rental.nextChargeDate;
  const anchor = parseDateKey(rental.startDate);
  if (!anchor) return null;
  const lastDue = rental.charges.length > 0
    ? parseDateKey([...rental.charges].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]!.dueDate)
    : anchor;
  if (!lastDue) return null;
  return toDateKey(addCalendarDays(lastDue, intervalDays(rental.frequency)));
}
