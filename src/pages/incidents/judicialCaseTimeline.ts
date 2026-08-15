import type { CollisionCaseRecord } from "../../cloudData";

export type JudicialCaseTimelineEvent = {
  id: string;
  occurredAt: string;
  title: string;
  description: string;
  detail?: string;
  tone: "neutral" | "info" | "success" | "warning";
};

function eventTimestamp(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
}

export function buildJudicialCaseTimeline(item: CollisionCaseRecord): JudicialCaseTimelineEvent[] {
  const fallback = item.updatedAt || item.createdAt;
  const events: JudicialCaseTimelineEvent[] = [{
    id: `created-${item.id}`,
    occurredAt: eventTimestamp(item.createdAt, fallback),
    title: "Expediente creado",
    description: `Colisión de la unidad ${item.unit || "sin unidad"} registrada para gestión judicial.`,
    detail: item.trialDate ? `Juicio programado para ${item.trialDate}.` : "Fecha de juicio pendiente.",
    tone: "neutral"
  }];

  for (const change of item.trialDateHistory) {
    events.push({
      id: `trial-date-${change.changedAt}-${change.newDate}`,
      occurredAt: eventTimestamp(change.changedAt, fallback),
      title: "Fecha de juicio actualizada",
      description: `${change.previousDate || "Sin fecha"} → ${change.newDate}`,
      detail: change.reason,
      tone: "warning"
    });
  }

  if (item.attendanceConfirmedAt) {
    events.push({
      id: `attendance-${item.attendanceConfirmedAt}`,
      occurredAt: eventTimestamp(item.attendanceConfirmedAt, fallback),
      title: "Asistencia confirmada",
      description: `Cliente: ${item.clientWillAttend ? "sí asistirá" : "no asistirá"}. Asistencia legal: ${item.legalAssistanceRequested ? "solicitada" : "no solicitada"}.`,
      tone: "success"
    });
  }

  for (const note of item.judicialFollowUps) {
    events.push({
      id: `note-${note.id}`,
      occurredAt: eventTimestamp(note.createdAt, fallback),
      title: "Nota agregada",
      description: note.comment,
      detail: `Próximo paso: ${note.nextStep}${note.nextActionDate ? ` · Próxima gestión: ${note.nextActionDate}` : ""}`,
      tone: "info"
    });
  }

  if (item.expenseInvoice) {
    events.push({
      id: `balance-${item.expenseInvoice.chargeId}`,
      occurredAt: eventTimestamp(item.expenseInvoice.createdAt, fallback),
      title: "Saldo de colisión registrado",
      description: `${item.expenseInvoice.description || item.expenseInvoice.label}: $${item.expenseInvoice.amount.toFixed(2)}`,
      detail: item.expenseInvoice.attachment ? "Factura del taller adjunta." : "Sin factura adjunta.",
      tone: "warning"
    });
    if (item.expenseInvoice.creditedToRentAt) {
      events.push({
        id: `balance-credit-${item.expenseInvoice.creditedToRentAt}`,
        occurredAt: eventTimestamp(item.expenseInvoice.creditedToRentAt, fallback),
        title: "Saldo trasladado a la letra",
        description: `$${(item.expenseInvoice.creditedToRentAmount ?? 0).toFixed(2)} aplicados al estado de cuenta del cliente.`,
        tone: "success"
      });
    }
  }

  if (item.status === "ABSUELTO" || item.status === "CULPABLE") {
    events.push({
      id: `outcome-${item.id}-${item.status}`,
      occurredAt: eventTimestamp(item.judicialOutcomeEvidence?.uploadedAt ?? item.judicialResolutionEvidence?.uploadedAt, fallback),
      title: `Resultado del juicio: ${item.status}`,
      description: item.status === "ABSUELTO" ? "El cliente fue absuelto." : "El cliente fue declarado culpable.",
      detail: item.clientReturnedBeforeClosure ? "El cliente dejó el carro antes del cierre del caso." : undefined,
      tone: item.status === "ABSUELTO" ? "success" : "warning"
    });
  }

  if (item.judicialResolutionEvidence) {
    events.push({
      id: `resolution-${item.judicialResolutionEvidence.path}`,
      occurredAt: eventTimestamp(item.judicialResolutionEvidence.uploadedAt, fallback),
      title: "Resolución judicial adjuntada",
      description: item.judicialResolutionEvidence.name,
      detail: "El reclamo al seguro quedó habilitado.",
      tone: "success"
    });
  }

  if (item.insuranceClaim) {
    events.push({
      id: `insurance-${item.insuranceClaim.insuranceClaimId ?? item.id}`,
      occurredAt: eventTimestamp(item.insuranceClaim.updatedAt, fallback),
      title: "Reclamo al seguro actualizado",
      description: item.insuranceClaim.claimNumber ? `Reclamo ${item.insuranceClaim.claimNumber}` : "Reclamo guardado sin número.",
      detail: item.insuranceClaim.insurer || undefined,
      tone: "info"
    });
  }

  return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}
