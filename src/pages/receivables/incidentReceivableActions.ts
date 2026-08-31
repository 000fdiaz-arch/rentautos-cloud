import type { CollisionCaseRecord, InsuranceClaimRecord } from "../../cloudData";

export type IncidentReceivableAction = {
  targetId: string;
  destination: "judicial" | "insurance";
  label: string;
  date: string;
  urgent: boolean;
};

export function incidentActionBlocksManagement(action: IncidentReceivableAction | undefined): boolean {
  return Boolean(action?.urgent);
}

function shiftDateKey(dateKey: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function insuranceActionForReceivables(
  claim: InsuranceClaimRecord,
  todayDateKey: string
): IncidentReceivableAction | null {
  const base = { targetId: claim.id, destination: "insurance" as const };
  if (claim.documentationPending) {
    const deadline = shiftDateKey(claim.documentationPendingSince?.slice(0, 10) ?? "", 2);
    return { ...base, label: "Coordinar entrega presencial del FUD", date: deadline, urgent: Boolean(deadline && deadline <= todayDateKey) };
  }
  if (claim.status === "Finalizado") return null;
  if (!claim.claimNumber.trim()) return { ...base, label: "Agregar número de reclamo", date: "", urgent: true };
  if (claim.settlementDelivered) return { ...base, label: "Finalizar reclamo", date: claim.settlementDeliveredDate, urgent: true };
  return { ...base, label: "Dar seguimiento y gestionar finiquito", date: "", urgent: false };
}

export function collisionActionForReceivables(
  collision: CollisionCaseRecord,
  todayDateKey: string
): IncidentReceivableAction | null {
  const base = { targetId: collision.id, destination: "judicial" as const };
  if (collision.status === "CULPABLE") return null;
  if (collision.documentationPending) {
    const deadline = shiftDateKey(collision.documentationPendingSince?.slice(0, 10) ?? "", 2);
    return { ...base, label: "Obtener y registrar la colilla", date: deadline, urgent: Boolean(deadline && deadline <= todayDateKey) };
  }
  if (collision.status === "ABSUELTO") {
    if (!collision.judicialResolutionEvidence) {
      return { ...base, label: "Buscar y adjuntar resolución judicial", date: "", urgent: true };
    }
    if (!collision.insuranceClaim?.insuranceClaimId) {
      return { ...base, label: "Iniciar reclamo al seguro", date: "", urgent: true };
    }
    return null;
  }
  if (collision.trialDate && collision.trialDate <= todayDateKey) {
    return { ...base, label: "Registrar resultado del juicio", date: collision.trialDate, urgent: true };
  }
  const attendancePending = typeof collision.clientWillAttend !== "boolean"
    || typeof collision.legalAssistanceRequested !== "boolean";
  if (collision.trialDate && attendancePending) {
    const deadline = shiftDateKey(collision.trialDate, -10);
    return {
      ...base,
      label: "Confirmar si el cliente irá y si se pidió asistencia legal",
      date: deadline,
      urgent: Boolean(deadline && deadline <= todayDateKey)
    };
  }
  if (!collision.trialDate) return { ...base, label: "Asignar fecha de juicio", date: "", urgent: true };
  return null;
}

type IncidentCandidate = {
  unit: string;
  updatedAt: string;
  action: IncidentReceivableAction;
};

export function buildIncidentActionsByUnit(
  claims: InsuranceClaimRecord[],
  collisions: CollisionCaseRecord[],
  todayDateKey: string
): Record<string, IncidentReceivableAction> {
  const candidates: IncidentCandidate[] = [];
  for (const claim of claims) {
    const action = insuranceActionForReceivables(claim, todayDateKey);
    if (action) candidates.push({ unit: claim.unit.trim().toUpperCase(), updatedAt: claim.updatedAt || claim.createdAt, action });
  }
  for (const collision of collisions) {
    const action = collisionActionForReceivables(collision, todayDateKey);
    if (action) candidates.push({ unit: collision.unit.trim().toUpperCase(), updatedAt: collision.updatedAt || collision.createdAt, action });
  }
  candidates.sort((left, right) => {
    if (left.action.urgent !== right.action.urgent) return left.action.urgent ? -1 : 1;
    if (left.action.date !== right.action.date) {
      if (!left.action.date) return -1;
      if (!right.action.date) return 1;
      return left.action.date.localeCompare(right.action.date);
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  const result: Record<string, IncidentReceivableAction> = {};
  for (const candidate of candidates) {
    if (candidate.unit && !result[candidate.unit]) result[candidate.unit] = candidate.action;
  }
  return result;
}
