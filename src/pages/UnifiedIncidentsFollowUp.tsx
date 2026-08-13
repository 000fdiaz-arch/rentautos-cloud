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

type Props = {
  dataOwnerUserId?: string | null;
  canViewJudicial: boolean;
  canViewInsurance: boolean;
  refreshKey: number;
  onOpen: (destination: IncidentDestination, target: { id: string; search: string }) => void;
  onAlertCountChange?: (count: number) => void;
};

type FollowUpFilter = "all" | "judicial" | "insurance_active" | "insurance_inactive" | "finalized";
type NextActionFilter = "all" | "judicial_management" | "judicial_result" | "judicial_resolution" | "start_claim" | "claim_number" | "insurance_follow_up" | "finalize_claim" | "finalized";
type IncidentAlertSeverity = "urgent" | "attention" | "upcoming";

const NEXT_ACTION_LABELS: Record<NextActionFilter, string> = {
  all: "Todas las acciones",
  judicial_management: "Gestionar juicio",
  judicial_result: "Registrar resultado del juicio",
  judicial_resolution: "Buscar resolución judicial",
  start_claim: "Iniciar reclamo al seguro",
  claim_number: "Agregar número de reclamo",
  insurance_follow_up: "Seguimiento del seguro",
  finalize_claim: "Finalizar reclamo",
  finalized: "Sin acciones pendientes"
};
const ACTION_QUEUE_FILTERS: NextActionFilter[] = [
  "judicial_result",
  "judicial_resolution",
  "start_claim",
  "claim_number",
  "insurance_follow_up",
  "finalize_claim",
  "judicial_management"
];

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

function incidentMatchesFilter(incident: UnifiedIncident, filter: FollowUpFilter): boolean {
  if (filter === "judicial") return Boolean(incident.collision);
  if (filter === "insurance_active") return incident.claim?.status === "Activo";
  if (filter === "insurance_inactive") return incident.claim?.status === "Inactivo";
  if (filter === "finalized") return incident.finalized;
  return true;
}

function nextActionCategory(incident: UnifiedIncident): NextActionFilter {
  if (incident.finalized) return "finalized";
  const collision = incident.collision;
  const claim = incident.claim;
  if (collision?.status === "ABSUELTO" && !collision.judicialResolutionEvidence) return "judicial_resolution";
  if (collision?.status === "ABSUELTO" && collision.judicialResolutionEvidence && !claim) return "start_claim";
  if (collision && collision.status !== "ABSUELTO" && collision.status !== "CULPABLE") {
    if (collision.trialDate && collision.trialDate <= localDateKey()) return "judicial_result";
    return "judicial_management";
  }
  if (claim && !claim.claimNumber.trim()) return "claim_number";
  if (claim?.settlementDelivered) return "finalize_claim";
  if (claim) return "insurance_follow_up";
  return "judicial_management";
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

    if (collision && collision.status !== "ABSUELTO" && collision.status !== "CULPABLE") {
      const trialOffset = collision.trialDate ? calendarDayOffset(collision.trialDate) : null;
      if (!collision.trialDate) {
        addAlert(incident, {
          id: `${incident.id}:trial-missing`, kind: "judicial", severity: "urgent", priority: 10,
          title: "Juicio sin fecha", message: "El expediente todavía no tiene una fecha de juicio asignada.",
          actionLabel: "Asignar fecha", destination: "judicial", targetId: collision.id
        });
      } else if (trialOffset !== null && trialOffset < 0) {
        const overdueDays = Math.abs(trialOffset);
        addAlert(incident, {
          id: `${incident.id}:trial-overdue`, kind: "judicial", severity: "urgent", priority: 1,
          title: "Juicio vencido sin resultado", message: `La fecha fue ${collision.trialDate}; han pasado ${overdueDays} ${overdueDays === 1 ? "día" : "días"}.`,
          actionLabel: "Registrar resultado", destination: "judicial", targetId: collision.id
        });
      } else if (trialOffset === 0) {
        addAlert(incident, {
          id: `${incident.id}:trial-today`, kind: "judicial", severity: "urgent", priority: 2,
          title: "Juicio programado para hoy", message: "El juicio requiere seguimiento durante el día de hoy.",
          actionLabel: "Gestionar juicio", destination: "judicial", targetId: collision.id
        });
      } else if (trialOffset !== null && trialOffset >= 1) {
        addAlert(incident, {
          id: `${incident.id}:trial-upcoming`, kind: "judicial", severity: "upcoming", priority: 30 + trialOffset,
          title: trialOffset === 1 ? "Juicio programado para mañana" : `Juicio dentro de ${trialOffset} días`,
          message: `Fecha de juicio: ${collision.trialDate}.`, actionLabel: "Ver juicio", destination: "judicial", targetId: collision.id
        });
      }
      const latestFollowUp = collision.judicialFollowUps[collision.judicialFollowUps.length - 1];
      const followUpOffset = latestFollowUp?.nextActionDate ? calendarDayOffset(latestFollowUp.nextActionDate) : null;
      if (latestFollowUp && followUpOffset !== null && followUpOffset < 0) {
        const overdueDays = Math.abs(followUpOffset);
        addAlert(incident, {
          id: `${incident.id}:judicial-follow-up-overdue`, kind: "judicial", severity: "urgent", priority: 6,
          title: "Seguimiento judicial vencido", message: `${latestFollowUp.nextStep}. Venció hace ${overdueDays} ${overdueDays === 1 ? "día" : "días"}.`,
          actionLabel: "Registrar seguimiento", destination: "judicial", targetId: collision.id
        });
      } else if (latestFollowUp && followUpOffset === 0) {
        addAlert(incident, {
          id: `${incident.id}:judicial-follow-up-today`, kind: "judicial", severity: "urgent", priority: 7,
          title: "Seguimiento judicial para hoy", message: latestFollowUp.nextStep,
          actionLabel: "Registrar seguimiento", destination: "judicial", targetId: collision.id
        });
      } else if (latestFollowUp && followUpOffset !== null && followUpOffset >= 1 && followUpOffset <= 3) {
        addAlert(incident, {
          id: `${incident.id}:judicial-follow-up-upcoming`, kind: "judicial", severity: "upcoming", priority: 34 + followUpOffset,
          title: followUpOffset === 1 ? "Seguimiento judicial para mañana" : `Seguimiento judicial dentro de ${followUpOffset} días`,
          message: latestFollowUp.nextStep, actionLabel: "Ver seguimiento", destination: "judicial", targetId: collision.id
        });
      }
    }

    if (collision?.status === "ABSUELTO" && !collision.judicialResolutionEvidence) {
      addAlert(incident, {
        id: `${incident.id}:resolution-missing`, kind: "judicial", severity: "urgent", priority: 3,
        title: "Resolución judicial pendiente", message: "El juicio quedó absuelto, pero falta buscar y adjuntar la resolución para habilitar el reclamo.",
        actionLabel: "Adjuntar resolución", destination: "judicial", targetId: collision.id
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

    const latestClaimFollowUp = claim.followUps[claim.followUps.length - 1];
    if (!latestClaimFollowUp && createdDays !== null && createdDays >= 3) {
      addAlert(incident, {
        id: `${incident.id}:first-follow-up-missing`, kind: "insurance", severity: "urgent", priority: 4,
        title: "Reclamo sin primer seguimiento", message: `El reclamo está activo desde hace ${createdDays} días y no tiene seguimiento registrado.`,
        actionLabel: "Registrar seguimiento", destination: "insurance", targetId: claim.id
      });
    } else if (latestClaimFollowUp) {
      const followUpOffset = latestClaimFollowUp.nextActionDate ? calendarDayOffset(latestClaimFollowUp.nextActionDate) : null;
      if (followUpOffset !== null && followUpOffset < 0) {
        const overdueDays = Math.abs(followUpOffset);
        addAlert(incident, {
          id: `${incident.id}:claim-follow-up-overdue`, kind: "insurance", severity: "urgent", priority: 8,
          title: "Seguimiento del reclamo vencido", message: `${latestClaimFollowUp.nextStep}. Venció hace ${overdueDays} ${overdueDays === 1 ? "día" : "días"}.`,
          actionLabel: "Registrar seguimiento", destination: "insurance", targetId: claim.id
        });
      } else if (followUpOffset === 0) {
        addAlert(incident, {
          id: `${incident.id}:claim-follow-up-today`, kind: "insurance", severity: "urgent", priority: 9,
          title: "Seguimiento del reclamo para hoy", message: latestClaimFollowUp.nextStep,
          actionLabel: "Registrar seguimiento", destination: "insurance", targetId: claim.id
        });
      } else if (followUpOffset !== null && followUpOffset >= 1 && followUpOffset <= 3) {
        addAlert(incident, {
          id: `${incident.id}:claim-follow-up-upcoming`, kind: "insurance", severity: "upcoming", priority: 38 + followUpOffset,
          title: followUpOffset === 1 ? "Seguimiento del reclamo para mañana" : `Seguimiento del reclamo dentro de ${followUpOffset} días`,
          message: latestClaimFollowUp.nextStep, actionLabel: "Ver seguimiento", destination: "insurance", targetId: claim.id
        });
      }
      const lastUpdate = latestClaimFollowUp.createdAt || claim.followUpCommentUpdatedAt || claim.updatedAt || claim.createdAt;
      const staleDays = calendarDaysSince(dateKeyFromTimestamp(lastUpdate));
      if (staleDays !== null && staleDays >= 30) {
        addAlert(incident, {
          id: `${incident.id}:claim-stale-30`, kind: "insurance", severity: "urgent", priority: 5,
          title: "Reclamo estancado", message: `Han pasado ${staleDays} días sin una actualización de seguimiento.`,
          actionLabel: "Actualizar reclamo", destination: "insurance", targetId: claim.id
        });
      } else if (staleDays !== null && staleDays >= 15) {
        addAlert(incident, {
          id: `${incident.id}:claim-stale-15`, kind: "insurance", severity: "attention", priority: 22,
          title: "Reclamo sin actualización", message: `Han pasado ${staleDays} días sin una actualización de seguimiento.`,
          actionLabel: "Actualizar reclamo", destination: "insurance", targetId: claim.id
        });
      }
    }
  });

  return alerts.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.priority - right.priority || left.title.localeCompare(right.title, "es"));
}

function claimNextAction(claim: InsuranceClaimRecord): { label: string; finalized: boolean; requiresAction: boolean } {
  if (claim.status === "Finalizado") return { label: `Reclamo ${claim.closureOutcome?.toLocaleLowerCase("es") ?? "finalizado"}`, finalized: true, requiresAction: false };
  if (!claim.claimNumber.trim()) return { label: "Agregar número de reclamo", finalized: false, requiresAction: true };
  const latestFollowUp = claim.followUps[claim.followUps.length - 1];
  if (!latestFollowUp) return { label: "Registrar seguimiento del seguro", finalized: false, requiresAction: true };
  if (claim.settlementDelivered) return { label: "Finalizar reclamo", finalized: false, requiresAction: true };
  if (latestFollowUp.nextActionDate) {
    const followUpDue = latestFollowUp.nextActionDate <= localDateKey();
    return {
      label: `${followUpDue ? "Realizar seguimiento del seguro" : `Próxima gestión ${latestFollowUp.nextActionDate}`}: ${latestFollowUp.nextStep}`,
      finalized: false,
      requiresAction: followUpDue
    };
  }
  return { label: "Dar seguimiento y gestionar finiquito", finalized: false, requiresAction: false };
}

function collisionNextAction(collision: CollisionCaseRecord, claim: InsuranceClaimRecord | null): { label: string; finalized: boolean; requiresAction: boolean } {
  if (collision.status === "CULPABLE") return {
    label: collision.clientReturnedBeforeClosure ? "Cliente dejó el carro antes del cierre" : "Expediente judicial finalizado",
    finalized: true,
    requiresAction: false
  };
  if (collision.status === "ABSUELTO") {
    if (!collision.judicialResolutionEvidence) return { label: "Buscar y adjuntar resolución judicial", finalized: false, requiresAction: true };
    if (claim) return claimNextAction(claim);
    return { label: "Iniciar reclamo al seguro", finalized: false, requiresAction: true };
  }
  const requiresResult = Boolean(collision.trialDate && collision.trialDate <= localDateKey());
  if (requiresResult) return { label: "Registrar resultado del juicio", finalized: false, requiresAction: true };
  const latestFollowUp = collision.judicialFollowUps[collision.judicialFollowUps.length - 1];
  if (latestFollowUp?.nextActionDate) {
    const followUpDue = latestFollowUp.nextActionDate <= localDateKey();
    return {
      label: `${followUpDue ? "Realizar seguimiento judicial" : `Próxima gestión ${latestFollowUp.nextActionDate}`}: ${latestFollowUp.nextStep}`,
      finalized: false,
      requiresAction: followUpDue
    };
  }
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

export default function UnifiedIncidentsFollowUp({ dataOwnerUserId, canViewJudicial, canViewInsurance, refreshKey, onOpen, onAlertCountChange }: Props) {
  const [collisions, setCollisions] = useState<CollisionCaseRecord[]>([]);
  const [claims, setClaims] = useState<InsuranceClaimRecord[]>([]);
  const [fleetUnits, setFleetUnits] = useState<ControlUnitRow[]>([]);
  const [filter, setFilter] = useState<FollowUpFilter>("all");
  const [nextActionFilter, setNextActionFilter] = useState<NextActionFilter>("all");
  const [search, setSearch] = useState("");
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
  const alertIncidentCount = useMemo(() => new Set(alerts.map((alert) => alert.incidentId)).size, [alerts]);
  const alertsByIncident = useMemo(() => {
    const grouped = new Map<string, IncidentAlert[]>();
    alerts.forEach((alert) => grouped.set(alert.incidentId, [...(grouped.get(alert.incidentId) ?? []), alert]));
    return grouped;
  }, [alerts]);

  useEffect(() => {
    onAlertCountChange?.(alertIncidentCount);
  }, [alertIncidentCount, onAlertCountChange]);
  const filterCounts = useMemo(() => {
    const count = (nextFilter: FollowUpFilter) => incidents.filter((incident) => incidentMatchesFilter(incident, nextFilter)).length;
    return {
      all: incidents.length,
      judicial: count("judicial"),
      insurance_active: count("insurance_active"),
      insurance_inactive: count("insurance_inactive"),
      finalized: count("finalized")
    };
  }, [incidents]);
  const nextActionCounts = useMemo(() => {
    const counts = {} as Record<NextActionFilter, number>;
    (Object.keys(NEXT_ACTION_LABELS) as NextActionFilter[]).forEach((key) => { counts[key] = key === "all" ? incidents.length : 0; });
    incidents.forEach((incident) => { counts[nextActionCategory(incident)] += 1; });
    return counts;
  }, [incidents]);
  const nextTrial = useMemo(() => {
    const upcomingTrials = collisions
      .filter((item) => item.status !== "ABSUELTO" && item.status !== "CULPABLE" && Boolean(item.trialDate))
      .map((item) => ({ date: item.trialDate, offset: calendarDayOffset(item.trialDate) }))
      .filter((item): item is { date: string; offset: number } => item.offset !== null && item.offset >= 0)
      .sort((left, right) => left.offset - right.offset);
    return upcomingTrials[0] ?? null;
  }, [collisions]);
  const nextTrialRelativeLabel = nextTrial
    ? nextTrial.offset === 0 ? "hoy" : nextTrial.offset === 1 ? "mañana" : `en ${nextTrial.offset} días`
    : "";
  const nextTrialFilterLabel = nextTrial ? `Próximo: ${nextTrialRelativeLabel}` : "";
  const nextTrialQueueLabel = nextTrial ? `Próximo: ${shortCalendarDate(nextTrial.date)} · ${nextTrialRelativeLabel}` : "";
  const filteredIncidents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    return incidents.filter((incident) => {
      if (!incidentMatchesFilter(incident, filter)) return false;
      if (nextActionFilter !== "all" && nextActionCategory(incident) !== nextActionFilter) return false;
      if (!needle) return true;
      return [incident.unit, incident.driver, incident.plate, incident.vehicleYear, incident.vehicleDamage, incident.nextAction,
        incident.claim?.claimNumber ?? "", incident.claim?.insurer ?? "", incident.claim?.status ?? ""]
        .some((value) => value.toLocaleLowerCase("es").includes(needle));
    });
  }, [alertsByIncident, filter, incidents, nextActionFilter, search]);
  const hasActiveFilters = Boolean(search.trim() || filter !== "all" || nextActionFilter !== "all");

  function openAlert(alert: IncidentAlert): void {
    onOpen(alert.destination, { id: alert.targetId, search: alert.unit });
  }

  function openNextAction(incident: UnifiedIncident): void {
    const category = nextActionCategory(incident);
    if ((category === "claim_number" || category === "insurance_follow_up" || category === "finalize_claim") && incident.claim) {
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
    setFilter("all");
    setSearch("");
    setNextActionFilter("all");
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
      {!loading && !loadError && <section className="incident-action-queue" aria-labelledby="incident-action-queue-title">
        <div className="incident-action-queue-head"><div><span className="workflow-eyebrow">Gestión prioritaria</span><h3 id="incident-action-queue-title">Acciones pendientes</h3></div><strong>{incidents.filter((incident) => !incident.finalized).length} pendientes</strong></div>
        <div className="incident-action-queue-list">
          {ACTION_QUEUE_FILTERS.filter((key) => nextActionCounts[key] > 0).map((key) => <button type="button" key={key} className={nextActionFilter === key ? "active" : ""} onClick={() => setNextActionFilter(nextActionFilter === key ? "all" : key)}><strong>{nextActionCounts[key]}</strong><span>{NEXT_ACTION_LABELS[key]}</span>{key === "judicial_management" && nextTrialQueueLabel && <em className="incident-action-queue-trial">{nextTrialQueueLabel}</em>}<small>Ver casos →</small></button>)}
          {!ACTION_QUEUE_FILTERS.some((key) => nextActionCounts[key] > 0) && <p>Todo al día. No hay acciones pendientes.</p>}
        </div>
      </section>}
      <div className="unified-incidents-toolbar" role="region" aria-label="Filtros fijos de expedientes y alertas">
        <div className="unified-incidents-filter-head">
          <label className="workflow-claim-search">Buscar<input type="search" value={search} placeholder="Unidad, placa, año, aseguradora o número de reclamo" onChange={(event) => setSearch(event.target.value)} /></label>
          <button type="button" className="button ghost small unified-incidents-clear" onClick={clearFilters} disabled={!hasActiveFilters}>Limpiar filtros</button>
        </div>
        <div className="unified-incidents-filter-groups">
          <section className="unified-incidents-filter-section" aria-labelledby="incident-type-filter-title">
            <span className="unified-incidents-filter-title" id="incident-type-filter-title">Tipo de expediente</span>
            <div className="unified-incidents-filters unified-incidents-filters--types" aria-label="Filtrar por tipo de expediente">
              <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos <span>{filterCounts.all}</span></button>
              {canViewJudicial && <button type="button" className={filter === "judicial" ? "active" : ""} onClick={() => setFilter("judicial")}><strong className="unified-filter-label">Juicios <b>{filterCounts.judicial}</b></strong>{nextTrialFilterLabel && <small className="unified-filter-next-trial">{nextTrialFilterLabel}</small>}</button>}
              {canViewInsurance && <button type="button" className={filter === "insurance_active" ? "active" : ""} onClick={() => setFilter("insurance_active")}>Con reclamo activo <span>{filterCounts.insurance_active}</span></button>}
              {canViewInsurance && <button type="button" className={filter === "insurance_inactive" ? "active" : ""} onClick={() => setFilter("insurance_inactive")}>Sin número de reclamo <span>{filterCounts.insurance_inactive}</span></button>}
              <button type="button" className={filter === "finalized" ? "active" : ""} onClick={() => setFilter("finalized")} disabled={filterCounts.finalized === 0}>Finalizados <span>{filterCounts.finalized}</span></button>
            </div>
          </section>
        </div>
      </div>
      <div className="workflow-claims-list unified-incidents-list">
        {!loading && !incidents.length && <p className="hint">Todavía no hay expedientes de siniestros.</p>}
        {!loading && incidents.length > 0 && !filteredIncidents.length && <p className="hint workflow-empty-filter">No hay expedientes que coincidan con los filtros.</p>}
        {filteredIncidents.map((incident) => {
          const expanded = expandedId === incident.id;
          const claimState = !incident.claim ? "none" : incident.claim.status === "Activo" ? "active" : incident.claim.status === "Inactivo" ? "inactive" : "finished";
          const claimStateLabel = claimState === "active" ? "Reclamo activo" : claimState === "inactive" ? "Reclamo inactivo" : claimState === "finished" ? "Reclamo finalizado" : "Sin reclamo";
          const incidentAlerts = alertsByIncident.get(incident.id) ?? [];
          const topAlert = incidentAlerts[0];
          const ageLabel = incidentAgeLabel(incident.incidentDate);
          const trialDaysRemaining = incident.collision && incident.collision.status !== "ABSUELTO" && incident.collision.status !== "CULPABLE" && incident.collision.trialDate
            ? calendarDayOffset(incident.collision.trialDate)
            : null;
          const trialCountdownLabel = trialDaysRemaining !== null && trialDaysRemaining > 0
            ? trialDaysRemaining === 1 ? "Juicio mañana" : `Juicio en ${trialDaysRemaining} días`
            : "";
          const topAlertIsTrialCountdown = topAlert?.id === `${incident.id}:trial-upcoming`;
          const judicialFinalized = incident.collision?.status === "ABSUELTO" || incident.collision?.status === "CULPABLE";
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
                {incident.claim?.claimNumber && <span className="unified-incident-claim-reference"><small>N.º {incident.claim.claimNumber}</small><button type="button" className="unified-claim-copy" aria-label={`Copiar número de reclamo ${incident.claim.claimNumber}`} title="Copiar número de reclamo" onClick={(event) => { event.stopPropagation(); void copyClaimNumber(incident.claim!); }}>{copiedClaimId === incident.claim.id ? "✓" : "⧉"}</button></span>}
                {incident.claim?.insurer && <small className="unified-incident-insurer">{incident.claim.insurer}</small>}
                {(trialCountdownLabel || topAlert) && <div className="unified-incident-card-alerts">
                  {trialCountdownLabel && <span className="unified-incident-alert severity-upcoming" role="status"><b>◷</b> {trialCountdownLabel}</span>}
                  {topAlert && !topAlertIsTrialCountdown && <span className={`unified-incident-alert severity-${topAlert.severity}`} role="status"><b>{topAlert.severity === "urgent" ? "!" : topAlert.severity === "attention" ? "⚠" : "◷"}</b> {topAlert.title}</span>}
                </div>}
              </div>
              <div className={`unified-incident-action${incident.requiresAction ? " attention" : incident.finalized ? " complete" : ""}`}>
                <small>{incident.finalized ? "Estado" : "Próxima acción"}</small>
                <strong>{incident.nextAction}</strong>
                <div className="unified-incident-action-buttons">
                  {!incident.finalized && <button type="button" className="button primary" onClick={(event) => { event.stopPropagation(); openNextAction(incident); }}>Gestionar ahora</button>}
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
                <div className="workflow-claim-damage"><dt>Daños del auto</dt><dd>{incident.vehicleDamage || "Sin descripción"}</dd></div>
              </dl>
              {incidentAlerts.length > 1 && <div className="unified-incident-secondary-alerts">
                <strong>Otras alertas del expediente</strong>
                {incidentAlerts.slice(1).map((alert) => <button type="button" key={alert.id} className={`severity-${alert.severity}`} onClick={() => openAlert(alert)}><span>{alert.title}</span><small>{alert.message}</small></button>)}
              </div>}
            </div>}
          </article>;
        })}
      </div>
    </section>
  );
}
