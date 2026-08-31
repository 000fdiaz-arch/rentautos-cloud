import { useEffect, useMemo, useState } from "react";
import {
  loadCollisionCases,
  loadControlUnits,
  loadInsuranceClaims,
  type CollisionCaseRecord,
  type ControlUnitRow,
  type InsuranceClaimRecord
} from "../cloudData";
import type { IncidentDestination } from "./IncidentIntakeForm";
import { daysUntilAttendanceConfirmation, nextPendingJudicialStep } from "./incidents/judicialCaseNavigation";
import { documentationAlertState } from "./incidents/incidentDocumentation";
import { dateMatchesRange } from "./incidents/incidentFilterRules";
import "./incidents/incidentFilters.css";

type Props = {
  dataOwnerUserId?: string | null;
  canViewJudicial: boolean;
  canViewInsurance: boolean;
  refreshKey: number;
  onOpen: (destination: IncidentDestination, target: { id: string; search: string; section?: "follow_up" }) => void;
  onAlertCountChange?: (count: number) => void;
};

type AreaFilter = "pending" | "judicial" | "insurance" | "finalized";
type NextActionCategory = "documentation" | "judicial_management" | "judicial_workshop" | "judicial_balance" | "judicial_attendance" | "judicial_result" | "judicial_resolution" | "start_claim" | "claim_number" | "insurance_follow_up" | "finalize_claim";
type NextActionGroupKey = "insurance_follow_up" | "claim_number" | "documentation" | "claim_lifecycle" | "workshop" | "judicial_resolution" | "judicial_attendance" | "judicial_balance" | "custom";
type ActionTimingFilter = "all" | "overdue" | "today" | "upcoming";
type DateFieldFilter = "incident" | "next_action";
type IncidentSort = "action_asc" | "incident_desc" | "updated_desc" | "unit_asc";
type IncidentAlertSeverity = "urgent" | "attention" | "upcoming";
type IncidentsWorkspaceView = "incidents" | "agenda";

type IncidentAlert = {
  id: string;
  incidentId: string;
  kind: "judicial" | "insurance";
  severity: IncidentAlertSeverity;
  title: string;
  message: string;
  actionLabel: string;
  destination: IncidentDestination;
  targetId: string;
  unit: string;
  plate: string;
  priority: number;
};

type UnifiedIncident = {
  id: string;
  incidentDate: string;
  unit: string;
  driver: string;
  plate: string;
  vehicleYear: string;
  vehicleDamage: string;
  collision: CollisionCaseRecord | null;
  claim: InsuranceClaimRecord | null;
  nextAction: string;
  finalized: boolean;
  requiresAction: boolean;
  updatedAt: string;
};

type IncidentNoteSummary = {
  comment: string;
  createdAt: string;
  destination: IncidentDestination;
  targetId: string;
};

const NEXT_ACTION_GROUPS: Array<{ value: NextActionGroupKey; label: string }> = [
  { value: "insurance_follow_up", label: "Gestión con aseguradora" },
  { value: "claim_number", label: "Número de reclamo" },
  { value: "documentation", label: "Documentación / FUD" },
  { value: "claim_lifecycle", label: "Iniciar o finalizar reclamo" },
  { value: "workshop", label: "Taller / revisión" },
  { value: "judicial_resolution", label: "Resolución o resultado judicial" },
  { value: "judicial_attendance", label: "Asistencia legal" },
  { value: "judicial_balance", label: "Saldo judicial" },
  { value: "custom", label: "Esperando juicio" }
];

function latestNote<T extends { createdAt: string }>(entries: T[]): T | undefined {
  return entries.reduce<T | undefined>((latest, entry) => !latest || entry.createdAt > latest.createdAt ? entry : latest, undefined);
}

function incidentMatchesFilter(incident: UnifiedIncident, filter: AreaFilter): boolean {
  const resolutionPending = incident.collision?.status === "ABSUELTO" && !incident.collision.judicialResolutionEvidence;
  if (filter === "pending") return !incident.finalized;
  if (filter === "judicial") return !incident.finalized && Boolean(incident.collision && (!incident.claim || resolutionPending));
  if (filter === "insurance") return !incident.finalized && !resolutionPending && Boolean(incident.claim);
  if (filter === "finalized") return incident.finalized;
  return false;
}

function nextActionCategory(incident: UnifiedIncident): NextActionCategory | null {
  if (incident.collision?.documentationPending || incident.claim?.documentationPending) return "documentation";
  if (incident.finalized) return null;
  const collision = incident.collision;
  const claim = incident.claim;
  if (collision?.status === "ABSUELTO" && !collision.judicialResolutionEvidence) return "judicial_resolution";
  if (collision?.status === "ABSUELTO" && collision.judicialResolutionEvidence && !claim) return "start_claim";
  if (collision && collision.status !== "ABSUELTO" && collision.status !== "CULPABLE") {
    const pendingStep = nextPendingJudicialStep(collision, localDateKey());
    if (pendingStep === "workshop") return "judicial_workshop";
    if (pendingStep === "balance") return "judicial_balance";
    if (pendingStep === "attendance") return "judicial_attendance";
    if (pendingStep === "outcome") return "judicial_result";
    return "judicial_management";
  }
  if (claim && !claim.claimNumber.trim()) return "claim_number";
  if (claim?.settlementDelivered) return "finalize_claim";
  if (claim) return "insurance_follow_up";
  return "judicial_management";
}

function nextActionButtonLabel(incident: UnifiedIncident): string {
  switch (nextActionCategory(incident)) {
    case "documentation": return "Completar documentación";
    case "judicial_workshop": return "Confirmar revisión";
    case "judicial_balance": return "Registrar saldo";
    case "judicial_attendance": return "Confirmar asistencia";
    case "judicial_result": return "Registrar resultado";
    case "judicial_resolution": return "Gestionar resolución";
    case "start_claim": return "Iniciar reclamo";
    case "claim_number": return "Agregar número de reclamo";
    case "insurance_follow_up": return "Gestionar reclamo";
    case "finalize_claim": return "Finalizar reclamo";
    default: return "Ver paso pendiente";
  }
}

function normalizeLookupValue(value: string): string {
  return value.trim().toLocaleUpperCase("es").replace(/[\s-]+/g, "");
}

function vehicleYear(unit?: ControlUnitRow): string {
  const year = unit?.model_year ?? unit?.year;
  return year === null || year === undefined ? "" : String(year).trim();
}

function dateKeyFromTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return localDateKey(date);
}

function calendarDayOffset(value: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const incidentDay = Date.UTC(year, month - 1, day);
  const parsedIncident = new Date(incidentDay);
  if (parsedIncident.getUTCFullYear() !== year || parsedIncident.getUTCMonth() !== month - 1 || parsedIncident.getUTCDate() !== day) return null;
  const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((incidentDay - currentDay) / 86_400_000);
}

function shortCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match.map(Number);
  return new Intl.DateTimeFormat("es-PA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace(/\./g, "");
}

function calendarDaysSince(value: string, today = new Date()): number | null {
  const offset = calendarDayOffset(value, today);
  return offset === null ? null : Math.max(0, -offset);
}

function incidentAgeLabel(value: string): string {
  const days = calendarDaysSince(value);
  if (days === null) return "";
  if (days === 0) return "Hoy";
  if (days === 1) return "Hace 1 día";
  return `Hace ${days} días`;
}

function incidentLatestNote(incident: UnifiedIncident): IncidentNoteSummary | null {
  const claimNote = latestNote(incident.claim?.followUps ?? []);
  const judicialNote = latestNote(incident.collision?.judicialFollowUps ?? []);
  const entry = !claimNote ? judicialNote : !judicialNote || claimNote.createdAt >= judicialNote.createdAt ? claimNote : judicialNote;
  if (!entry) return null;
  return {
    comment: entry.comment,
    createdAt: entry.createdAt,
    destination: entry === claimNote ? "insurance" : "judicial",
    targetId: entry === claimNote ? incident.claim!.id : incident.collision!.id
  };
}

function visibleNextAction(incident: UnifiedIncident): string | null {
  if (incident.finalized) return null;
  return incident.nextAction.trim() || "Acción pendiente";
}

function nextActionGroup(incident: UnifiedIncident): { value: NextActionGroupKey; label: string } | null {
  if (incident.finalized) return null;
  const value: NextActionGroupKey = (() => {
      const category = nextActionCategory(incident);
      if (category === "insurance_follow_up") return "insurance_follow_up";
      if (category === "claim_number") return "claim_number";
      if (category === "documentation") return "documentation";
      if (category === "start_claim" || category === "finalize_claim") return "claim_lifecycle";
      if (category === "judicial_workshop") return "workshop";
      if (category === "judicial_resolution" || category === "judicial_result") return "judicial_resolution";
      if (category === "judicial_attendance") return "judicial_attendance";
      if (category === "judicial_balance") return "judicial_balance";
      return "custom";
    })();
  return NEXT_ACTION_GROUPS.find((group) => group.value === value) ?? null;
}

type IncidentActionSchedule = {
  date: string;
  label: string;
};

type JudicialTrialReadiness = {
  ready: boolean;
  missing: string[];
};

function judicialTrialReadiness(collision: CollisionCaseRecord): JudicialTrialReadiness {
  const missing: string[] = [];
  if (collision.documentationPending) missing.push("Completar documentación");
  if (typeof collision.clientWillAttend !== "boolean") missing.push("Confirmar asistencia del cliente");
  if (typeof collision.legalAssistanceRequested !== "boolean") missing.push("Definir asistencia legal");
  if (!collision.vehicleInspectedAt && !collision.expenseInvoice) missing.push("Revisar el vehículo");
  if (!collision.expenseInvoice) missing.push("Registrar saldo de colisión");
  return { ready: missing.length === 0, missing };
}

function offsetCalendarDate(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function actionScheduleLabel(date: string): string {
  const offset = calendarDayOffset(date);
  if (offset === null) return "Fecha de acción pendiente";
  if (offset < 0) {
    const days = Math.abs(offset);
    return `Accionar: ${shortCalendarDate(date)} · vencido hace ${days} ${days === 1 ? "día" : "días"}`;
  }
  if (offset === 0) return "Accionar hoy";
  if (offset === 1) return `Accionar: ${shortCalendarDate(date)} · mañana`;
  return `Accionar: ${shortCalendarDate(date)} · en ${offset} días`;
}

function incidentActionSchedule(incident: UnifiedIncident): IncidentActionSchedule | null {
  if (incident.finalized) return null;
  const today = localDateKey();
  const collision = incident.collision;
  const claim = incident.claim;
  if (collision?.documentationPending || claim?.documentationPending) {
    const pendingSince = collision?.documentationPending
      ? collision.documentationPendingSince
      : claim?.documentationPendingSince;
    const date = pendingSince ? dateKeyFromTimestamp(pendingSince) : incident.incidentDate || today;
    return { date: date || today, label: actionScheduleLabel(date || today) };
  }
  if (collision?.status === "ABSUELTO" && !collision.judicialResolutionEvidence) {
    const date = collision.judicialResolutionSearchDate || today;
    return { date, label: actionScheduleLabel(date) };
  }
  if (collision && collision.status !== "ABSUELTO" && collision.status !== "CULPABLE") {
    const pendingStep = nextPendingJudicialStep(collision, today);
    if (pendingStep === "attendance") {
      const date = offsetCalendarDate(collision.trialDate, -10) || today;
      return { date, label: actionScheduleLabel(date) };
    }
    if ((pendingStep === "outcome" || pendingStep === "management") && collision.trialDate) {
      return { date: collision.trialDate, label: actionScheduleLabel(collision.trialDate) };
    }
  }
  return { date: today, label: "Accionar hoy" };
}

function compareByActionDate(left: UnifiedIncident, right: UnifiedIncident): number {
  const leftSchedule = incidentActionSchedule(left);
  const rightSchedule = incidentActionSchedule(right);
  if (leftSchedule && rightSchedule) {
    const dateOrder = leftSchedule.date.localeCompare(rightSchedule.date);
    if (dateOrder !== 0) return dateOrder;
    if (left.requiresAction !== right.requiresAction) return left.requiresAction ? -1 : 1;
    return left.updatedAt.localeCompare(right.updatedAt);
  }
  if (leftSchedule) return -1;
  if (rightSchedule) return 1;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function compareIncidents(left: UnifiedIncident, right: UnifiedIncident, sort: IncidentSort): number {
  if (sort === "incident_desc") return right.incidentDate.localeCompare(left.incidentDate) || compareByActionDate(left, right);
  if (sort === "updated_desc") return right.updatedAt.localeCompare(left.updatedAt) || compareByActionDate(left, right);
  if (sort === "unit_asc") return left.unit.localeCompare(right.unit, "es", { numeric: true, sensitivity: "base" }) || compareByActionDate(left, right);
  return compareByActionDate(left, right);
}

function incidentActionTiming(incident: UnifiedIncident): ActionTimingFilter {
  const schedule = incidentActionSchedule(incident);
  if (!schedule) return "all";
  const offset = calendarDayOffset(schedule.date);
  if (offset === null) return "all";
  if (offset < 0) return "overdue";
  if (offset === 0) return "today";
  return "upcoming";
}

function countImmediateIncidentActions(incidents: UnifiedIncident[]): number {
  return incidents.filter((incident) => {
    const timing = incidentActionTiming(incident);
    if (timing === "overdue" || timing === "today") return true;
    const collision = incident.collision;
    if (!collision || collision.status === "ABSUELTO" || collision.status === "CULPABLE" || !collision.trialDate) return false;
    const trialOffset = calendarDayOffset(collision.trialDate);
    return trialOffset !== null && trialOffset >= 1 && trialOffset <= 10;
  }).length;
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildIncidentAlerts(incidents: UnifiedIncident[], canViewInsurance: boolean): IncidentAlert[] {
  const alerts: IncidentAlert[] = [];
  const severityOrder: Record<IncidentAlertSeverity, number> = { urgent: 0, attention: 1, upcoming: 2 };
  const addAlert = (incident: UnifiedIncident, alert: Omit<IncidentAlert, "incidentId" | "unit" | "plate">) => {
    alerts.push({ ...alert, incidentId: incident.id, unit: incident.unit, plate: incident.plate });
  };

  incidents.forEach((incident) => {
    const collision = incident.collision;
    const claim = incident.claim;
    const pendingDocument = collision?.documentationPending ? "colilla" : claim?.documentationPending ? "FUD" : "";
    if (pendingDocument) {
      const insuranceFudPending = pendingDocument === "FUD";
      const pendingSince = collision?.documentationPending ? collision.documentationPendingSince : claim?.documentationPendingSince;
      const alertState = documentationAlertState(pendingSince ?? incident.updatedAt);
      const overdue = alertState.hoursPending >= 48;
      const delayed = alertState.hoursPending >= 24;
      addAlert(incident, {
        id: `${incident.id}:documentation-pending`, kind: collision?.documentationPending ? "judicial" : "insurance",
        severity: alertState.severity, priority: overdue ? 0 : delayed ? 1 : 7,
        title: insuranceFudPending
          ? overdue ? "Entrega presencial del FUD vencida" : delayed ? "Entrega presencial del FUD sin confirmar" : "Entrega presencial del FUD pendiente"
          : alertState.title === "Pendiente" ? "Colilla pendiente" : alertState.title,
        message: insuranceFudPending
          ? overdue
            ? `Han pasado ${alertState.hoursPending} horas sin confirmar la entrega presencial del FUD original. Requiere seguimiento urgente.`
            : delayed
              ? "Han pasado al menos 24 horas. Contacta nuevamente para coordinar la entrega presencial del FUD original."
              : "Coordina la entrega presencial del FUD original y agrega cada novedad en Notas. Una copia digital no sustituye la entrega física."
          : overdue
            ? `Han pasado ${alertState.hoursPending} horas sin recibir la colilla. Requiere seguimiento urgente.`
            : delayed
              ? "Han pasado al menos 24 horas. Contacta nuevamente para obtener la colilla."
              : "Solicita la colilla y agrega cada novedad en Notas.",
        actionLabel: insuranceFudPending ? "Confirmar entrega presencial" : "Completar documentación", destination: collision?.documentationPending ? "judicial" : "insurance", targetId: collision?.id ?? claim!.id
      });
      return;
    }

    if (collision && collision.status !== "ABSUELTO" && collision.status !== "CULPABLE") {
      const trialOffset = collision.trialDate ? calendarDayOffset(collision.trialDate) : null;
      const pendingStep = nextPendingJudicialStep(collision, localDateKey());
      const attendanceIncomplete = typeof collision.clientWillAttend !== "boolean" || typeof collision.legalAssistanceRequested !== "boolean";
      if (trialOffset !== null && trialOffset <= 10 && attendanceIncomplete) {
        const urgent = trialOffset <= 3;
        addAlert(incident, {
          id: `${incident.id}:attendance-confirmation`, kind: "judicial", severity: urgent ? "urgent" : "attention", priority: urgent ? 2 : 12 + Math.max(0, trialOffset),
          title: "Confirmación de asistencia pendiente",
          message: "Confirma si el cliente irá y si se pidió asistencia legal.",
          actionLabel: "Confirmar asistencia", destination: "judicial", targetId: collision.id
        });
      }
      if ((trialOffset === null || trialOffset > 0) && pendingStep === "workshop") {
        addAlert(incident, {
          id: `${incident.id}:workshop-pending`, kind: "judicial", severity: "attention", priority: 8,
          title: "Vehículo pendiente de revisión", message: "El cliente debe llevar el vehículo al taller para verificar su estado.",
          actionLabel: "Confirmar revisión", destination: "judicial", targetId: collision.id
        });
      } else if ((trialOffset === null || trialOffset > 0) && pendingStep === "balance") {
        addAlert(incident, {
          id: `${incident.id}:collision-balance-pending`, kind: "judicial", severity: "attention", priority: 9,
          title: "Saldo de colisión pendiente", message: "La revisión del vehículo está completa; falta registrar el costo de reparación.",
          actionLabel: "Registrar saldo", destination: "judicial", targetId: collision.id
        });
      }
      if (!collision.trialDate) {
        addAlert(incident, {
          id: `${incident.id}:trial-missing`, kind: "judicial", severity: "urgent", priority: 10,
          title: "Juicio sin fecha", message: "El expediente todavía no tiene una fecha de juicio asignada.",
          actionLabel: "Asignar fecha", destination: "judicial", targetId: collision.id
        });
      } else if (trialOffset !== null && trialOffset < 0) {
        const overdueDays = Math.abs(trialOffset);
        const title = pendingStep === "workshop"
          ? "Juicio vencido: falta revisar el vehículo"
          : pendingStep === "balance"
            ? "Juicio vencido: falta el saldo de colisión"
            : "Juicio vencido sin resultado";
        const actionLabel = pendingStep === "workshop" ? "Confirmar revisión" : pendingStep === "balance" ? "Registrar saldo" : "Registrar resultado";
        addAlert(incident, {
          id: `${incident.id}:trial-overdue`, kind: "judicial", severity: "urgent", priority: 1,
          title, message: `La fecha fue ${collision.trialDate}; han pasado ${overdueDays} ${overdueDays === 1 ? "día" : "días"}. Completa primero la acción indicada.`,
          actionLabel, destination: "judicial", targetId: collision.id
        });
      } else if (trialOffset === 0) {
        const title = pendingStep === "workshop"
          ? "Juicio hoy: falta revisar el vehículo"
          : pendingStep === "balance"
            ? "Juicio hoy: falta el saldo de colisión"
            : "Juicio programado para hoy";
        const actionLabel = pendingStep === "workshop" ? "Confirmar revisión" : pendingStep === "balance" ? "Registrar saldo" : "Gestionar juicio";
        addAlert(incident, {
          id: `${incident.id}:trial-today`, kind: "judicial", severity: "urgent", priority: 2,
          title, message: pendingStep === "outcome" ? "El juicio requiere registrar su resultado." : "Completa primero la acción indicada para continuar el flujo.",
          actionLabel, destination: "judicial", targetId: collision.id
        });
      } else if (trialOffset !== null && trialOffset >= 1) {
        const closeTrial = trialOffset <= 10;
        const imminentTrial = trialOffset <= 3;
        addAlert(incident, {
          id: `${incident.id}:trial-upcoming`, kind: "judicial", severity: imminentTrial ? "urgent" : closeTrial ? "attention" : "upcoming", priority: imminentTrial ? 3 + trialOffset : closeTrial ? 15 + trialOffset : 30 + trialOffset,
          title: trialOffset === 1 ? "Juicio programado para mañana" : `Juicio dentro de ${trialOffset} días`,
          message: closeTrial ? `Alerta: el juicio es el ${collision.trialDate}.` : `Fecha de juicio: ${collision.trialDate}.`, actionLabel: "Ver juicio", destination: "judicial", targetId: collision.id
        });
      }
    }

    if (collision?.status === "ABSUELTO" && !collision.judicialResolutionEvidence) {
      const resolutionDate = collision.judicialResolutionSearchDate;
      const resolutionOffset = resolutionDate ? calendarDayOffset(resolutionDate) : null;
      const resolutionOverdue = resolutionOffset !== null && resolutionOffset < 0;
      const resolutionDue = resolutionOffset === null || resolutionOffset <= 0;
      const resolutionSoon = resolutionOffset !== null && resolutionOffset > 0 && resolutionOffset <= 3;
      const overdueDays = resolutionOverdue ? Math.abs(resolutionOffset) : 0;
      addAlert(incident, {
        id: `${incident.id}:resolution-missing`, kind: "judicial",
        severity: resolutionDue ? "urgent" : resolutionSoon ? "attention" : "upcoming",
        priority: resolutionDue ? 3 : resolutionSoon ? 18 + resolutionOffset : 40 + (resolutionOffset ?? 0),
        title: resolutionOverdue
          ? "Búsqueda de resolución vencida"
          : resolutionOffset === 0
            ? "Buscar resolución judicial hoy"
            : resolutionOffset === 1
              ? "Buscar resolución judicial mañana"
              : "Búsqueda de resolución programada",
        message: resolutionOverdue
          ? `La búsqueda estaba programada para el ${shortCalendarDate(resolutionDate!)} y venció hace ${overdueDays} ${overdueDays === 1 ? "día" : "días"}.`
          : resolutionDate
            ? `Buscar y adjuntar la resolución el ${shortCalendarDate(resolutionDate)}${resolutionOffset && resolutionOffset > 1 ? `, dentro de ${resolutionOffset} días` : ""}.`
            : "Falta definir la fecha para buscar y adjuntar la resolución judicial.",
        actionLabel: resolutionDue ? "Adjuntar resolución" : "Ver fecha programada", destination: "judicial", targetId: collision.id
      });
    }

    if (canViewInsurance && collision?.status === "ABSUELTO" && collision.judicialResolutionEvidence && !claim) {
      const wonDays = calendarDaysSince(dateKeyFromTimestamp(collision.updatedAt));
      if (wonDays !== null && wonDays >= 2) {
        addAlert(incident, {
          id: `${incident.id}:won-without-claim`, kind: "insurance", severity: "attention", priority: 20,
          title: "Juicio ganado sin reclamo", message: `Han pasado ${wonDays} días desde la última actualización y aún no se inició el reclamo.`,
          actionLabel: "Iniciar reclamo", destination: "judicial", targetId: collision.id
        });
      }
    }

    if (collision?.status === "ABSUELTO" && !collision.judicialResolutionEvidence) return;
    if (!claim || claim.status === "Finalizado") return;
    const createdDays = calendarDaysSince(dateKeyFromTimestamp(claim.createdAt));
    if (claim.status === "Inactivo" && !claim.claimNumber.trim() && createdDays !== null && createdDays >= 3) {
      addAlert(incident, {
        id: `${incident.id}:claim-number-missing`, kind: "insurance", severity: "attention", priority: 21,
        title: "Reclamo sin número", message: `El reclamo lleva ${createdDays} días inactivo y todavía no tiene número asignado.`,
        actionLabel: "Agregar número", destination: "insurance", targetId: claim.id
      });
    }
    if (claim.status !== "Activo") return;

    if (claim.settlementDelivered) {
      addAlert(incident, {
        id: `${incident.id}:settlement-active`, kind: "insurance", severity: "urgent", priority: 3,
        title: "Finiquito entregado con reclamo activo", message: "El finiquito ya fue entregado, pero el reclamo todavía no se ha finalizado.",
        actionLabel: "Finalizar reclamo", destination: "insurance", targetId: claim.id
      });
    }

    const latestClaimNote = latestNote(claim.followUps);
    const lastUpdate = latestClaimNote?.createdAt || claim.followUpCommentUpdatedAt || claim.updatedAt || claim.createdAt;
    const staleDays = calendarDaysSince(dateKeyFromTimestamp(lastUpdate));
    if (staleDays !== null && staleDays >= 30) {
      addAlert(incident, {
        id: `${incident.id}:claim-stale-30`, kind: "insurance", severity: "urgent", priority: 5,
        title: "Reclamo estancado", message: `Han pasado ${staleDays} días sin una actualización del expediente.`,
        actionLabel: "Gestionar reclamo", destination: "insurance", targetId: claim.id
      });
    } else if (staleDays !== null && staleDays >= 15) {
      addAlert(incident, {
        id: `${incident.id}:claim-stale-15`, kind: "insurance", severity: "attention", priority: 22,
        title: "Reclamo sin actualización", message: `Han pasado ${staleDays} días sin una actualización del expediente.`,
        actionLabel: "Gestionar reclamo", destination: "insurance", targetId: claim.id
      });
    }
  });

  return alerts.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.priority - right.priority || left.title.localeCompare(right.title, "es"));
}

function claimNextAction(claim: InsuranceClaimRecord): { label: string; finalized: boolean; requiresAction: boolean } {
  if (claim.documentationPending) return { label: "Coordinar entrega presencial del FUD", finalized: false, requiresAction: true };
  if (claim.status === "Finalizado") return { label: `Reclamo ${claim.closureOutcome?.toLocaleLowerCase("es") ?? "finalizado"}`, finalized: true, requiresAction: false };
  if (!claim.claimNumber.trim()) return { label: "Agregar número de reclamo", finalized: false, requiresAction: true };
  if (claim.settlementDelivered) return { label: "Finalizar reclamo", finalized: false, requiresAction: true };
  return { label: "Dar seguimiento y gestionar finiquito", finalized: false, requiresAction: true };
}

function collisionNextAction(collision: CollisionCaseRecord, claim: InsuranceClaimRecord | null): { label: string; finalized: boolean; requiresAction: boolean } {
  if (collision.documentationPending) return { label: "Obtener y registrar la colilla", finalized: false, requiresAction: true };
  if (collision.status === "CULPABLE") return {
    label: collision.clientReturnedBeforeClosure ? "Cliente dejó el carro antes del cierre" : "Expediente judicial finalizado",
    finalized: true,
    requiresAction: false
  };
  if (collision.status === "ABSUELTO") {
    if (!collision.judicialResolutionEvidence) {
      const resolutionDate = collision.judicialResolutionSearchDate;
      const resolutionOffset = resolutionDate ? calendarDayOffset(resolutionDate) : null;
      return {
        label: resolutionDate
          ? `Buscar y adjuntar resolución judicial · ${shortCalendarDate(resolutionDate)}`
          : "Definir fecha para buscar y adjuntar resolución judicial",
        finalized: false,
        requiresAction: resolutionOffset === null || resolutionOffset <= 0
      };
    }
    if (claim) return claimNextAction(claim);
    return { label: "Iniciar reclamo al seguro", finalized: false, requiresAction: true };
  }
  const pendingStep = nextPendingJudicialStep(collision, localDateKey());
  if (pendingStep === "workshop") return { label: "Recibir y revisar el vehículo en el taller", finalized: false, requiresAction: true };
  if (pendingStep === "balance") return { label: "Registrar saldo de colisión", finalized: false, requiresAction: true };
  if (pendingStep === "outcome") return { label: "Registrar resultado del juicio", finalized: false, requiresAction: true };
  if (pendingStep === "attendance") return { label: "Confirmar si el cliente irá y si se pidió asistencia legal", finalized: false, requiresAction: true };
  const attendanceCountdown = daysUntilAttendanceConfirmation(collision, localDateKey());
  if (attendanceCountdown !== null) return {
    label: `En ${attendanceCountdown} ${attendanceCountdown === 1 ? "día" : "días"} se debe confirmar si el cliente irá y si se pidió asistencia legal`,
    finalized: false,
    requiresAction: false
  };
  return { label: collision.trialDate ? `Esperar juicio del ${collision.trialDate}` : "Asignar fecha de juicio", finalized: false, requiresAction: !collision.trialDate };
}

function mergeIncidents(collisions: CollisionCaseRecord[], claims: InsuranceClaimRecord[], fleetUnits: ControlUnitRow[]): UnifiedIncident[] {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const linkedClaimIds = new Set<string>();
  const fleetByUnit = new Map(fleetUnits.map((unit) => [normalizeLookupValue(unit.unit_id), unit]));
  const fleetByPlate = new Map(fleetUnits.flatMap((unit) => unit.plate ? [[normalizeLookupValue(unit.plate), unit] as const] : []));
  const findVehicleYear = (unit: string, plate: string): string => vehicleYear(
    fleetByUnit.get(normalizeLookupValue(unit)) ?? fleetByPlate.get(normalizeLookupValue(plate))
  );
  const incidents: UnifiedIncident[] = collisions.map((collision) => {
    const linkedId = collision.insuranceClaim?.insuranceClaimId;
    const claim = (linkedId ? claimsById.get(linkedId) : null) ?? claims.find((candidate) => (
      Boolean(collision.insuranceClaim?.claimNumber)
      && candidate.claimNumber.trim().toLocaleLowerCase("es") === collision.insuranceClaim?.claimNumber.trim().toLocaleLowerCase("es")
      && candidate.unit.trim().toLocaleUpperCase("es") === collision.unit.trim().toLocaleUpperCase("es")
      && candidate.incidentDate === collision.incidentDate
    )) ?? null;
    if (claim) linkedClaimIds.add(claim.id);
    const action = collisionNextAction(collision, claim);
    return {
      id: `collision:${collision.id}`,
      incidentDate: collision.incidentDate,
      unit: collision.unit,
      driver: collision.driver,
      plate: collision.plate,
      vehicleYear: findVehicleYear(collision.unit, collision.plate),
      vehicleDamage: collision.vehicleDamage,
      collision,
      claim,
      nextAction: action.label,
      finalized: action.finalized,
      requiresAction: action.requiresAction,
      updatedAt: claim?.updatedAt && claim.updatedAt > collision.updatedAt ? claim.updatedAt : collision.updatedAt
    };
  });

  claims.forEach((claim) => {
    if (linkedClaimIds.has(claim.id)) return;
    const action = claimNextAction(claim);
    incidents.push({
      id: `claim:${claim.id}`,
      incidentDate: claim.incidentDate,
      unit: claim.unit,
      driver: claim.driver,
      plate: claim.plate,
      vehicleYear: findVehicleYear(claim.unit, claim.plate),
      vehicleDamage: claim.vehicleDamage,
      collision: null,
      claim,
      nextAction: action.label,
      finalized: action.finalized,
      requiresAction: action.requiresAction,
      updatedAt: claim.updatedAt
    });
  });

  return incidents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function countIncidentAlerts(
  collisions: CollisionCaseRecord[],
  claims: InsuranceClaimRecord[],
  _canViewInsurance: boolean
): number {
  const incidents = mergeIncidents(collisions, claims, []);
  return countImmediateIncidentActions(incidents);
}

export default function UnifiedIncidentsFollowUp({ dataOwnerUserId, canViewJudicial, canViewInsurance, refreshKey, onOpen, onAlertCountChange }: Props) {
  const [collisions, setCollisions] = useState<CollisionCaseRecord[]>([]);
  const [claims, setClaims] = useState<InsuranceClaimRecord[]>([]);
  const [fleetUnits, setFleetUnits] = useState<ControlUnitRow[]>([]);
  const [filter, setFilter] = useState<AreaFilter>("pending");
  const [actionTimingFilter, setActionTimingFilter] = useState<ActionTimingFilter>("all");
  const [nextActionFilter, setNextActionFilter] = useState("all");
  const [insurerFilter, setInsurerFilter] = useState("all");
  const [dateFieldFilter, setDateFieldFilter] = useState<DateFieldFilter>("incident");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<IncidentSort>("action_asc");
  const [search, setSearch] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<IncidentsWorkspaceView>("incidents");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [copiedClaimId, setCopiedClaimId] = useState<string | null>(null);

  useEffect(() => {
    if (!dataOwnerUserId) { setLoading(false); setLoadError("No se encontró owner de datos para cargar los expedientes."); return; }
    let cancelled = false;
    setLoading(true); setLoadError("");
    Promise.all([
      canViewJudicial ? loadCollisionCases(dataOwnerUserId) : Promise.resolve([]),
      canViewInsurance ? loadInsuranceClaims(dataOwnerUserId) : Promise.resolve([]),
      loadControlUnits(dataOwnerUserId).catch((error) => {
        console.error("No se pudo cargar el año de las unidades para los expedientes.", error);
        return [];
      })
    ]).then(([nextCollisions, nextClaims, nextFleetUnits]) => {
      if (cancelled) return;
      setCollisions(nextCollisions);
      setClaims(nextClaims);
      setFleetUnits(nextFleetUnits);
    }).catch((error) => {
      if (cancelled) return;
      console.error("No se pudieron cargar los expedientes unificados.", error);
      setLoadError("No se pudieron cargar los expedientes de siniestros.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canViewInsurance, canViewJudicial, dataOwnerUserId, refreshKey]);

  const incidents = useMemo(() => mergeIncidents(collisions, claims, fleetUnits), [claims, collisions, fleetUnits]);
  const alerts = useMemo(() => buildIncidentAlerts(incidents, canViewInsurance), [canViewInsurance, incidents]);
  const immediateIncidentCount = useMemo(() => countImmediateIncidentActions(incidents), [incidents]);
  const trialOverview = useMemo(() => {
    const openJudicial = incidents.filter((incident) => incident.collision && incident.collision.status !== "ABSUELTO" && incident.collision.status !== "CULPABLE");
    const missingDate = openJudicial.filter((incident) => !incident.collision!.trialDate);
    const upcoming = openJudicial
      .map((incident) => ({ incident, offset: calendarDayOffset(incident.collision!.trialDate) }))
      .filter((entry): entry is { incident: UnifiedIncident; offset: number } => entry.offset !== null && entry.offset >= 0)
      .sort((left, right) => left.offset - right.offset || left.incident.collision!.trialDate.localeCompare(right.incident.collision!.trialDate) || left.incident.unit.localeCompare(right.incident.unit, "es", { numeric: true }));
    return { next: upcoming[0] ?? null, upcoming: upcoming.slice(0, 5), upcomingCount: upcoming.length, missingDate };
  }, [incidents]);
  const alertsByIncident = useMemo(() => {
    const grouped = new Map<string, IncidentAlert[]>();
    alerts.forEach((alert) => grouped.set(alert.incidentId, [...(grouped.get(alert.incidentId) ?? []), alert]));
    return grouped;
  }, [alerts]);

  useEffect(() => {
    if (!loading && !loadError) onAlertCountChange?.(immediateIncidentCount);
  }, [immediateIncidentCount, loadError, loading, onAlertCountChange]);
  const filterCounts = useMemo(() => {
    const count = (nextFilter: AreaFilter) => incidents.filter((incident) => incidentMatchesFilter(incident, nextFilter)).length;
    return {
      pending: count("pending"),
      judicial: count("judicial"),
      insurance: count("insurance"),
      finalized: count("finalized")
    };
  }, [incidents]);
  const actionTimingCounts = useMemo(() => incidents.reduce((counts, incident) => {
    if (incident.finalized) return counts;
    const timing = incidentActionTiming(incident);
    if (timing !== "all") counts[timing] += 1;
    return counts;
  }, { overdue: 0, today: 0, upcoming: 0 }), [incidents]);
  const incidentsMatchingActionContext = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    return incidents.filter((incident) => {
      if (!incidentMatchesFilter(incident, filter)) return false;
      if (actionTimingFilter !== "all" && incidentActionTiming(incident) !== actionTimingFilter) return false;
      if (insurerFilter !== "all" && incident.claim?.insurer.trim() !== insurerFilter) return false;
      if (dateFrom || dateTo) {
        const selectedDate = dateFieldFilter === "incident" ? incident.incidentDate : incidentActionSchedule(incident)?.date ?? "";
        if (!dateMatchesRange(selectedDate, dateFrom, dateTo)) return false;
      }
      if (!needle) return true;
      return [incident.unit, incident.driver, incident.plate, incident.vehicleYear, incident.vehicleDamage, visibleNextAction(incident) ?? "",
        incident.claim?.claimNumber ?? "", incident.claim?.insurer ?? "", incident.claim?.status ?? ""]
        .some((value) => value.toLocaleLowerCase("es").includes(needle));
    });
  }, [actionTimingFilter, dateFieldFilter, dateFrom, dateTo, filter, incidents, insurerFilter, search]);
  const nextActionOptions = useMemo(() => {
    const counts = new Map<NextActionGroupKey, number>();
    incidentsMatchingActionContext.forEach((incident) => {
      const group = nextActionGroup(incident);
      if (group) counts.set(group.value, (counts.get(group.value) ?? 0) + 1);
    });
    return NEXT_ACTION_GROUPS
      .map((group) => ({ ...group, count: counts.get(group.value) ?? 0 }))
      .filter((group) => group.count > 0)
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "es", { sensitivity: "base" }));
  }, [incidentsMatchingActionContext]);
  const nextActionTotal = useMemo(() => nextActionOptions.reduce((total, option) => total + option.count, 0), [nextActionOptions]);
  const insurers = useMemo(() => Array.from(new Set(incidents
    .map((incident) => incident.claim?.insurer.trim() ?? "")
    .filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" })), [incidents]);
  const filteredIncidents = useMemo(() => {
    return incidentsMatchingActionContext.filter((incident) => {
      if (nextActionFilter !== "all" && nextActionGroup(incident)?.value !== nextActionFilter) return false;
      return true;
    }).sort((left, right) => compareIncidents(left, right, sort));
  }, [incidentsMatchingActionContext, nextActionFilter, sort]);
  const hasActiveFilters = Boolean(search.trim() || filter !== "pending" || actionTimingFilter !== "all"
    || nextActionFilter !== "all" || insurerFilter !== "all" || dateFrom || dateTo || sort !== "action_asc");
  const activeFilterCount = [
    Boolean(search.trim()),
    filter !== "pending",
    actionTimingFilter !== "all",
    nextActionFilter !== "all",
    insurerFilter !== "all",
    Boolean(dateFrom || dateTo),
    sort !== "action_asc"
  ].filter(Boolean).length;

  function openAlert(alert: IncidentAlert): void {
    onOpen(alert.destination, { id: alert.targetId, search: alert.unit });
  }

  function openNextAction(incident: UnifiedIncident): void {
    const category = nextActionCategory(incident);
    if ((category === "documentation" || category === "claim_number" || category === "insurance_follow_up" || category === "finalize_claim") && incident.claim && !incident.collision?.documentationPending) {
      onOpen("insurance", { id: incident.claim.id, search: incident.unit });
      return;
    }
    if (incident.collision) {
      onOpen("judicial", { id: incident.collision.id, search: incident.unit });
      return;
    }
    if (incident.claim) onOpen("insurance", { id: incident.claim.id, search: incident.unit });
  }

  function clearFilters(): void {
    setFilter("pending");
    setSearch("");
    setActionTimingFilter("all");
    setNextActionFilter("all");
    setInsurerFilter("all");
    setDateFieldFilter("incident");
    setDateFrom("");
    setDateTo("");
    setSort("action_asc");
    setFiltersExpanded(false);
  }

  function selectAreaFilter(nextFilter: AreaFilter): void {
    setFilter(nextFilter);
    if (nextFilter === "finalized") {
      setNextActionFilter("all");
      setActionTimingFilter("all");
    }
  }

  function toggleActionTiming(nextTiming: Exclude<ActionTimingFilter, "all">): void {
    setActionTimingFilter((current) => current === nextTiming ? "all" : nextTiming);
  }

  async function copyClaimNumber(claim: InsuranceClaimRecord): Promise<void> {
    if (!claim.claimNumber) return;
    try {
      await navigator.clipboard.writeText(claim.claimNumber);
      setCopiedClaimId(claim.id);
      window.setTimeout(() => setCopiedClaimId((current) => current === claim.id ? null : current), 1800);
    } catch (error) {
      console.error("No se pudo copiar el número de reclamo.", error);
    }
  }

  return (
    <section className="panel workflow-claims-panel unified-incidents-follow-up">
      {loading && <p className="hint workflow-message">Cargando expedientes...</p>}
      {loadError && <p className="hint workflow-message">{loadError}</p>}
      {!loading && !loadError && canViewJudicial && <div className="incident-workspace-tabs" role="tablist" aria-label="Vistas de control de siniestros">
        <button type="button" role="tab" aria-selected={workspaceView === "incidents"} className={workspaceView === "incidents" ? "active" : ""} onClick={() => setWorkspaceView("incidents")}>Expedientes <b>{filterCounts.pending}</b></button>
        <button type="button" role="tab" aria-selected={workspaceView === "agenda"} className={workspaceView === "agenda" ? "active" : ""} onClick={() => setWorkspaceView("agenda")}>Agenda judicial <b>{trialOverview.upcomingCount}</b></button>
      </div>}
      {!loading && !loadError && workspaceView === "incidents" && (trialOverview.next || trialOverview.missingDate.length > 0) && (() => {
        const nextTrial = trialOverview.next;
        const severity: IncidentAlertSeverity = !nextTrial || nextTrial.offset <= 3 ? "urgent" : nextTrial.offset <= 10 ? "attention" : "upcoming";
        const timingLabel = !nextTrial ? "" : nextTrial.offset === 0 ? "Hoy" : nextTrial.offset === 1 ? "Mañana" : `Faltan ${nextTrial.offset} días`;
        return <button type="button" className={`incident-next-trial-compact severity-${severity}`} onClick={() => setWorkspaceView("agenda")}>
          <span><small>{nextTrial ? "Próximo juicio" : "Agenda judicial"}</small><strong>{nextTrial ? `${nextTrial.incident.unit || "Sin unidad"} · ${shortCalendarDate(nextTrial.incident.collision!.trialDate)}` : "No hay juicios próximos con fecha"}</strong>{nextTrial && <em>{timingLabel}</em>}</span>
          {trialOverview.missingDate.length > 0 && <b>{trialOverview.missingDate.length} {trialOverview.missingDate.length === 1 ? "sin fecha" : "sin fecha"}</b>}
          <i>Ver agenda →</i>
        </button>;
      })()}
      {!loading && !loadError && workspaceView === "agenda" && <section className="incident-trial-agenda" aria-labelledby="incident-trial-agenda-title" role="tabpanel">
        <div className="incident-trial-agenda-head">
          <div><small>Seguimiento preventivo</small><h3 id="incident-trial-agenda-title">Agenda judicial</h3><span>Los próximos cinco juicios, ordenados por fecha.</span></div>
          <div className="incident-next-trial-actions">
            <b className="incident-trial-agenda-count">{trialOverview.upcomingCount} {trialOverview.upcomingCount === 1 ? "próximo" : "próximos"}</b>
            {trialOverview.missingDate.length > 0 && <button type="button" className="button ghost incident-trials-missing" onClick={() => { const incident = trialOverview.missingDate[0]; onOpen("judicial", { id: incident.collision!.id, search: incident.unit }); }}><b>{trialOverview.missingDate.length}</b> {trialOverview.missingDate.length === 1 ? "juicio sin fecha" : "juicios sin fecha"}</button>}
          </div>
        </div>
        {trialOverview.upcoming.length > 0 ? <ol className="incident-trial-agenda-list">{trialOverview.upcoming.map((entry, index) => {
          const collision = entry.incident.collision!;
          const readiness = judicialTrialReadiness(collision);
          const severity: IncidentAlertSeverity = entry.offset <= 3 ? "urgent" : entry.offset <= 10 ? "attention" : "upcoming";
          const timingLabel = entry.offset === 0 ? "Hoy" : entry.offset === 1 ? "Mañana" : `Faltan ${entry.offset} días`;
          return <li key={collision.id} className={`severity-${severity}${index === 0 ? " is-next" : ""}`}>
            <time dateTime={collision.trialDate}><b>{shortCalendarDate(collision.trialDate)}</b><span>{timingLabel}</span></time>
            <div className="incident-trial-agenda-case"><strong>{entry.incident.unit || "Sin unidad"}</strong><span>{entry.incident.driver || "Sin conductor"}</span></div>
            <div className={`incident-trial-readiness${readiness.ready ? " is-ready" : " is-incomplete"}`}>
              <strong>{readiness.ready ? "✓ Listo para juicio" : `Faltan ${readiness.missing.length} ${readiness.missing.length === 1 ? "requisito" : "requisitos"}`}</strong>
              {!readiness.ready && <span title={readiness.missing.join(" · ")}>{readiness.missing.join(" · ")}</span>}
            </div>
            <button type="button" className={`button${index === 0 ? " primary" : " ghost"}`} onClick={() => onOpen("judicial", { id: collision.id, search: entry.incident.unit })}>Ver juicio</button>
          </li>;
        })}</ol> : <p className="incident-trial-agenda-empty">No hay juicios próximos con fecha.</p>}
      </section>}
      {!loading && !loadError && workspaceView === "incidents" && <section className="incident-action-strip" aria-label="Resumen de acciones por fecha">
        <span className="incident-action-strip-title">Acciones</span>
        <label className="incident-next-action-filter"><span className="unified-incidents-filter-label-with-count">Próx. acción <b>{nextActionTotal}</b></span>
          <select value={nextActionFilter} onChange={(event) => setNextActionFilter(event.target.value)}>
            <option value="all">Todas pendientes ({nextActionTotal})</option>
            {nextActionFilter !== "all" && !nextActionOptions.some((option) => option.value === nextActionFilter) && <option value={nextActionFilter}>{nextActionFilter} (0)</option>}
            {nextActionOptions.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count})</option>)}
          </select>
        </label>
        <button type="button" className={`overdue${actionTimingFilter === "overdue" ? " active" : ""}`} onClick={() => toggleActionTiming("overdue")}><strong>{actionTimingCounts.overdue}</strong><span>Vencidos</span></button>
        <button type="button" className={`today${actionTimingFilter === "today" ? " active" : ""}`} onClick={() => toggleActionTiming("today")}><strong>{actionTimingCounts.today}</strong><span>Para hoy</span></button>
        <button type="button" className={`upcoming${actionTimingFilter === "upcoming" ? " active" : ""}`} onClick={() => toggleActionTiming("upcoming")}><strong>{actionTimingCounts.upcoming}</strong><span>Próximos</span></button>
      </section>}
      {workspaceView === "incidents" && <div className="unified-incidents-toolbar" role="region" aria-label="Filtros fijos de expedientes y alertas">
        <div className="unified-incidents-filter-head">
          <label className="workflow-claim-search">Buscar<input type="search" value={search} placeholder="Unidad, conductor, placa, año, aseguradora o número de reclamo" onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="unified-incidents-filter-actions">
            <button
              type="button"
              className="button ghost small unified-incidents-filter-toggle"
              aria-expanded={filtersExpanded}
              aria-controls="unified-incidents-filter-groups"
              onClick={() => setFiltersExpanded((current) => !current)}
            >
              {filtersExpanded ? "Ocultar filtros" : `Mostrar filtros${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </button>
            <button type="button" className="button ghost small unified-incidents-clear" onClick={clearFilters} disabled={!hasActiveFilters}>
              Limpiar<span className="unified-incidents-clear-suffix"> filtros</span>
            </button>
          </div>
        </div>
        <div className="incident-area-quick-filters" aria-label="Filtros rápidos por área">
          <button type="button" className={filter === "pending" ? "active" : ""} onClick={() => selectAreaFilter("pending")}>Pendientes <b>{filterCounts.pending}</b></button>
          {canViewJudicial && <button type="button" className={filter === "judicial" ? "active" : ""} onClick={() => selectAreaFilter("judicial")}>Judicial <b>{filterCounts.judicial}</b></button>}
          {canViewInsurance && <button type="button" className={filter === "insurance" ? "active" : ""} onClick={() => selectAreaFilter("insurance")}>Seguro <b>{filterCounts.insurance}</b></button>}
          <button type="button" className={filter === "finalized" ? "active" : ""} onClick={() => selectAreaFilter("finalized")}>Finalizados <b>{filterCounts.finalized}</b></button>
        </div>
        <div id="unified-incidents-filter-groups" className={`unified-incidents-filter-groups${filtersExpanded ? " is-expanded" : ""}`}>
          <section className="unified-incidents-filter-section" aria-labelledby="incident-detail-filter-title">
            <span className="unified-incidents-filter-title" id="incident-detail-filter-title">Filtros operativos</span>
            <div className="unified-incidents-advanced-filters">
              {canViewInsurance && <label>Aseguradora
                <select value={insurerFilter} onChange={(event) => setInsurerFilter(event.target.value)}>
                  <option value="all">Todas</option>
                  {insurers.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}
                </select>
              </label>}
              <label>Fecha a consultar
                <select value={dateFieldFilter} onChange={(event) => setDateFieldFilter(event.target.value as DateFieldFilter)}>
                  <option value="incident">Fecha del siniestro</option>
                  <option value="next_action">Fecha de próxima acción</option>
                </select>
              </label>
              <label>Desde<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
              <label>Hasta<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
              <label>Ordenar por
                <select value={sort} onChange={(event) => setSort(event.target.value as IncidentSort)}>
                  <option value="action_asc">Próxima acción</option>
                  <option value="incident_desc">Siniestro más reciente</option>
                  <option value="updated_desc">Última actualización</option>
                  <option value="unit_asc">Unidad</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      </div>}
      {workspaceView === "incidents" && <div className="workflow-claims-list unified-incidents-list">
        {!loading && !incidents.length && <p className="hint">Todavía no hay expedientes de siniestros.</p>}
        {!loading && incidents.length > 0 && !filteredIncidents.length && <p className="hint workflow-empty-filter">No hay expedientes que coincidan con los filtros.</p>}
        {filteredIncidents.map((incident) => {
          const expanded = expandedId === incident.id;
          const resolutionPending = incident.collision?.status === "ABSUELTO" && !incident.collision.judicialResolutionEvidence;
          const claimState = resolutionPending || !incident.claim ? "none" : incident.claim.status === "Activo" ? "active" : incident.claim.status === "Inactivo" ? "inactive" : "finished";
          const claimStateLabel = resolutionPending
            ? "Resolución pendiente"
            : claimState === "active"
            ? "En gestión con aseguradora"
            : claimState === "inactive"
              ? "Falta información"
              : claimState === "finished"
                ? "Reclamo cerrado"
                : incident.collision?.status === "ABSUELTO"
                  ? "Reclamo pendiente"
                  : incident.collision
                    ? "Vía judicial"
                    : "Reclamo pendiente";
          const incidentAlerts = alertsByIncident.get(incident.id) ?? [];
          const topAlert = incidentAlerts[0];
          const ageLabel = incidentAgeLabel(incident.incidentDate);
          const trialDaysRemaining = incident.collision && incident.collision.status !== "ABSUELTO" && incident.collision.status !== "CULPABLE" && incident.collision.trialDate
            ? calendarDayOffset(incident.collision.trialDate)
            : null;
          const trialCountdownLabel = trialDaysRemaining !== null && trialDaysRemaining > 0
            ? trialDaysRemaining === 1 ? "Juicio mañana" : `Juicio en ${trialDaysRemaining} días`
            : "";
          const trialCountdownSeverity: IncidentAlertSeverity = trialDaysRemaining !== null && trialDaysRemaining <= 3 ? "urgent" : trialDaysRemaining !== null && trialDaysRemaining <= 10 ? "attention" : "upcoming";
          const topAlertIsTrialCountdown = topAlert?.id === `${incident.id}:trial-upcoming`;
          const judicialFinalized = incident.collision?.status === "ABSUELTO" || incident.collision?.status === "CULPABLE";
          const latestIncidentNote = incidentLatestNote(incident);
          const actionGroup = nextActionGroup(incident);
          const actionSchedule = incidentActionSchedule(incident);
          return <article key={incident.id} className={`unified-incident-card status-${claimState}${expanded ? " expanded" : ""}`}>
            <div className="unified-incident-summary" onClick={() => setExpandedId(expanded ? null : incident.id)}>
              <div className="unified-incident-identity">
                <strong>{incident.unit || "Sin unidad"} · {incident.driver || "Sin chofer"}</strong>
                <small>Incidente {incident.incidentDate || "sin fecha"}{ageLabel ? ` · ${ageLabel}` : ""}</small>
                <span className="unified-incident-vehicle-meta"><span>Placa <b>{incident.plate || "—"}</b></span><span>Año <b>{incident.vehicleYear || "—"}</b></span></span>
              </div>
              <div className="unified-incident-status-stack">
                <div className="unified-incident-status-line">
                  {judicialFinalized && <span className={`unified-incident-judicial-status status-${incident.collision!.status === "ABSUELTO" ? "absolved" : "guilty"}`}>Juicio: {incident.collision!.status}</span>}
                  <span className={`unified-incident-claim status-${claimState}`}><strong>{claimStateLabel}</strong></span>
                </div>
                {!resolutionPending && incident.claim?.claimNumber && <span className="unified-incident-claim-reference"><small>N.º {incident.claim.claimNumber}</small><button type="button" className="unified-claim-copy" aria-label={`Copiar número de reclamo ${incident.claim.claimNumber}`} title="Copiar número de reclamo" onClick={(event) => { event.stopPropagation(); void copyClaimNumber(incident.claim!); }}>{copiedClaimId === incident.claim.id ? "✓" : "⧉"}</button></span>}
                {!resolutionPending && incident.claim?.insurer && <small className="unified-incident-insurer">{incident.claim.insurer}</small>}
                {(trialCountdownLabel || topAlert) && <div className="unified-incident-card-alerts">
                  {trialCountdownLabel && <span className={`unified-incident-alert severity-${trialCountdownSeverity}`} role="status"><b>{trialCountdownSeverity === "urgent" ? "!" : trialCountdownSeverity === "attention" ? "⚠" : "◷"}</b> {trialCountdownLabel}</span>}
                  {topAlert && !topAlertIsTrialCountdown && <span className={`unified-incident-alert severity-${topAlert.severity}`} role="status"><b>{topAlert.severity === "urgent" ? "!" : topAlert.severity === "attention" ? "⚠" : "◷"}</b> {topAlert.title}</span>}
                </div>}
              </div>
              <div className={`unified-incident-action${incident.requiresAction ? " attention" : incident.finalized ? " complete" : ""}`}>
                {actionGroup && <span className="unified-incident-action-group">{actionGroup.label}</span>}
                <small>{incident.finalized ? "Estado" : "Acción pendiente"}</small>
                <strong>{incident.nextAction}</strong>
                {!incident.finalized && actionSchedule && <span className="unified-incident-follow-up-date"><b>{actionSchedule.label}</b></span>}
                {latestIncidentNote && <button type="button" className="unified-incident-latest-note" onClick={(event) => { event.stopPropagation(); onOpen(latestIncidentNote.destination, { id: latestIncidentNote.targetId, search: incident.unit, section: "follow_up" }); }}>
                  <span>Última nota · {new Date(latestIncidentNote.createdAt).toLocaleString("es-PA")}</span>
                  <strong>{latestIncidentNote.comment}</strong>
                </button>}
                <div className="unified-incident-action-buttons">
                  {!incident.finalized && <button type="button" className="button primary" onClick={(event) => { event.stopPropagation(); openNextAction(incident); }}>{nextActionButtonLabel(incident)}</button>}
                  <button type="button" className="button ghost" onClick={(event) => { event.stopPropagation(); if (incident.collision) onOpen("judicial", { id: incident.collision.id, search: incident.unit }); else if (incident.claim) onOpen("insurance", { id: incident.claim.id, search: incident.unit }); }}>Ver expediente</button>
                </div>
              </div>
              <button type="button" className="workflow-claim-chevron" aria-label={expanded ? "Contraer expediente" : "Expandir expediente"} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); setExpandedId(expanded ? null : incident.id); }}>{expanded ? "−" : "+"}</button>
            </div>
            {expanded && <div className="unified-incident-details">
              <dl className="workflow-claim-detail-grid">
                <div><dt>Fecha del incidente</dt><dd>{incident.incidentDate || "-"}</dd></div>
                <div><dt>Unidad / Placa</dt><dd>{incident.unit || "-"} / {incident.plate || "-"}</dd></div>
                <div><dt>Año del vehículo</dt><dd>{incident.vehicleYear || "-"}</dd></div>
                <div><dt>Chofer</dt><dd>{incident.driver || "-"}</dd></div>
                {incident.collision?.status === "ABSUELTO" && !incident.collision.judicialResolutionEvidence && <div><dt>Buscar resolución</dt><dd>{incident.collision.judicialResolutionSearchDate ? shortCalendarDate(incident.collision.judicialResolutionSearchDate) : "Fecha pendiente"}</dd></div>}
                <div className="workflow-claim-damage"><dt>Daños del auto</dt><dd>{incident.vehicleDamage || "Sin descripción"}</dd></div>
              </dl>
              {incidentAlerts.length > 1 && <div className="unified-incident-secondary-alerts">
                <strong>Otras alertas del expediente</strong>
                {incidentAlerts.slice(1).map((alert) => <button type="button" key={alert.id} className={`severity-${alert.severity}`} onClick={() => openAlert(alert)}><span>{alert.title}</span><small>{alert.message}</small></button>)}
              </div>}
            </div>}
          </article>;
        })}
      </div>}
    </section>
  );
}
