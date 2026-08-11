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

type FollowUpFilter = "all" | "action" | "judicial" | "insurance_active" | "insurance_inactive" | "finalized" | "urgent" | "attention" | "upcoming";
type IncidentAlertSeverity = "urgent" | "attention" | "upcoming";

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

function incidentMatchesFilter(incident: UnifiedIncident, filter: FollowUpFilter, incidentAlerts: IncidentAlert[]): boolean {
  if (filter === "judicial") return Boolean(incident.collision);
  if (filter === "insurance_active") return incident.claim?.status === "Activo";
  if (filter === "insurance_inactive") return incident.claim?.status === "Inactivo";
  if (filter === "action") return incidentAlerts.length > 0;
  if (filter === "finalized") return incident.finalized;
  if (filter === "urgent" || filter === "attention" || filter === "upcoming") return incidentAlerts.some((alert) => alert.severity === filter);
  return true;
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

    if (collision && collision.status !== "Ganó" && collision.status !== "Perdió") {
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
      } else if (trialOffset !== null && trialOffset >= 1 && trialOffset <= 3) {
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

    if (canViewInsurance && collision?.status === "Ganó" && !claim) {
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
  if (collision.status === "Perdió") return {
    label: collision.clientReturnedBeforeClosure ? "Cliente dejó el carro antes del cierre" : "Expediente judicial finalizado",
    finalized: true,
    requiresAction: false
  };
  if (collision.status === "Ganó") {
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
  const [alertCenterOpen, setAlertCenterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [insurerFilter, setInsurerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
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
  const alertCounts = useMemo(() => ({
    urgent: alerts.filter((alert) => alert.severity === "urgent").length,
    attention: alerts.filter((alert) => alert.severity === "attention").length,
    upcoming: alerts.filter((alert) => alert.severity === "upcoming").length
  }), [alerts]);
  const alertIncidentCount = useMemo(() => new Set(alerts.map((alert) => alert.incidentId)).size, [alerts]);
  const alertsByIncident = useMemo(() => {
    const grouped = new Map<string, IncidentAlert[]>();
    alerts.forEach((alert) => grouped.set(alert.incidentId, [...(grouped.get(alert.incidentId) ?? []), alert]));
    return grouped;
  }, [alerts]);

  useEffect(() => {
    onAlertCountChange?.(alertIncidentCount);
  }, [alertIncidentCount, onAlertCountChange]);
  const insurerOptions = useMemo(() => [...new Set(incidents.map((incident) => incident.claim?.insurer.trim() ?? "").filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es")), [incidents]);
  const filterCounts = useMemo(() => {
    const count = (nextFilter: FollowUpFilter) => incidents.filter((incident) => incidentMatchesFilter(incident, nextFilter, alertsByIncident.get(incident.id) ?? [])).length;
    return {
      all: incidents.length,
      action: count("action"),
      judicial: count("judicial"),
      insurance_active: count("insurance_active"),
      insurance_inactive: count("insurance_inactive"),
      finalized: count("finalized"),
      urgent: count("urgent"),
      attention: count("attention"),
      upcoming: count("upcoming")
    };
  }, [alertsByIncident, incidents]);
  const filteredIncidents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    return incidents.filter((incident) => {
      if (!incidentMatchesFilter(incident, filter, alertsByIncident.get(incident.id) ?? [])) return false;
      if (insurerFilter && incident.claim?.insurer !== insurerFilter) return false;
      if (dateFrom && incident.incidentDate < dateFrom) return false;
      if (dateTo && incident.incidentDate > dateTo) return false;
      if (!needle) return true;
      return [incident.unit, incident.driver, incident.plate, incident.vehicleYear, incident.vehicleDamage, incident.nextAction,
        incident.claim?.claimNumber ?? "", incident.claim?.insurer ?? "", incident.claim?.status ?? ""]
        .some((value) => value.toLocaleLowerCase("es").includes(needle));
    });
  }, [alertsByIncident, dateFrom, dateTo, filter, incidents, insurerFilter, search]);
  const filteredIncidentIds = useMemo(() => new Set(filteredIncidents.map((incident) => incident.id)), [filteredIncidents]);
  const filteredAlerts = useMemo(() => alerts.filter((alert) => {
    if (!filteredIncidentIds.has(alert.incidentId)) return false;
    if (filter === "urgent" || filter === "attention" || filter === "upcoming") return alert.severity === filter;
    if (filter === "judicial") return alert.kind === "judicial";
    if (filter === "insurance_active" || filter === "insurance_inactive") return alert.kind === "insurance";
    return true;
  }), [alerts, filter, filteredIncidentIds]);
  const filteredAlertIncidentCount = useMemo(() => new Set(filteredAlerts.map((alert) => alert.incidentId)).size, [filteredAlerts]);
  const hasActiveFilters = Boolean(search.trim() || filter !== "all" || insurerFilter || dateFrom || dateTo);

  function openAlert(alert: IncidentAlert): void {
    onOpen(alert.destination, { id: alert.targetId, search: alert.unit });
  }

  function openAlertCenter(nextFilter: Extract<FollowUpFilter, "urgent" | "attention" | "upcoming">): void {
    if (alertCenterOpen && filter === nextFilter) {
      setAlertCenterOpen(false);
      return;
    }
    setFilter(nextFilter);
    setAlertCenterOpen(true);
  }

  function clearFilters(): void {
    setFilter("all");
    setSearch("");
    setInsurerFilter("");
    setDateFrom("");
    setDateTo("");
    setAdvancedFiltersOpen(false);
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
      <div className="panel-head"><div><span className="workflow-eyebrow">Seguimiento unificado</span><h2>Expedientes de siniestros</h2></div><span className="hint">{filteredIncidents.length} de {incidents.length}</span></div>
      {loading && <p className="hint workflow-message">Cargando expedientes...</p>}
      {loadError && <p className="hint workflow-message">{loadError}</p>}
      {!loading && !loadError && <section className="incident-alert-center" aria-label="Alertas de juicios y reclamos">
        <p className="incident-alert-explainer"><strong>{alertIncidentCount} de {incidents.length} expedientes requieren seguimiento.</strong><span>Hay {alerts.length} {alerts.length === 1 ? "alerta activa" : "alertas activas"}; un expediente puede tener más de una.</span></p>
        <div className="incident-alert-summary" aria-label="Resumen de alertas activas">
          <button type="button" className={`incident-alert-metric severity-urgent${filter === "urgent" ? " active" : ""}`} aria-expanded={alertCenterOpen && filter === "urgent"} aria-controls="incident-alert-panel" onClick={() => openAlertCenter("urgent")}><small>Alertas urgentes</small><strong>{alertCounts.urgent}</strong><span>Requieren acción inmediata</span></button>
          <button type="button" className={`incident-alert-metric severity-attention${filter === "attention" ? " active" : ""}`} aria-expanded={alertCenterOpen && filter === "attention"} aria-controls="incident-alert-panel" onClick={() => openAlertCenter("attention")}><small>Alertas de atención</small><strong>{alertCounts.attention}</strong><span>Necesitan seguimiento</span></button>
          <button type="button" className={`incident-alert-metric severity-upcoming${filter === "upcoming" ? " active" : ""}`} aria-expanded={alertCenterOpen && filter === "upcoming"} aria-controls="incident-alert-panel" onClick={() => openAlertCenter("upcoming")}><small>Alertas próximas</small><strong>{alertCounts.upcoming}</strong><span>Juicios en los siguientes 3 días</span></button>
        </div>
        {alertCenterOpen && <div className="incident-alert-panel" id="incident-alert-panel">
          <div className="incident-alert-panel-head">
            <div><span className="workflow-eyebrow">Prioridades operativas</span><h3 id="incident-alert-center-title">Centro de alertas</h3></div>
            <div className="incident-alert-panel-actions"><span className="hint">{filteredAlertIncidentCount} {filteredAlertIncidentCount === 1 ? "expediente" : "expedientes"} · {filteredAlerts.length} {filteredAlerts.length === 1 ? "alerta" : "alertas"}</span><button type="button" className="incident-alert-close" aria-label="Cerrar centro de alertas" onClick={() => setAlertCenterOpen(false)}>Cerrar</button></div>
          </div>
          <div className="incident-alert-list" aria-live="polite">
            {!filteredAlerts.length && <p className="incident-alert-empty">No hay alertas activas para este filtro.</p>}
            {filteredAlerts.map((alert) => <article key={alert.id} className={`incident-alert-item severity-${alert.severity}`}>
              <span className="incident-alert-icon" aria-hidden="true">{alert.severity === "urgent" ? "!" : alert.severity === "attention" ? "⚠" : "◷"}</span>
              <span className="incident-alert-copy"><small>{alert.kind === "judicial" ? "Juicio" : "Reclamo"} · {alert.unit || "Sin unidad"}{alert.plate ? ` · ${alert.plate}` : ""}</small><strong>{alert.title}</strong><span>{alert.message}</span></span>
              <button type="button" className="button small" onClick={() => openAlert(alert)}>{alert.actionLabel}</button>
            </article>)}
          </div>
        </div>}
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
              {canViewJudicial && <button type="button" className={filter === "judicial" ? "active" : ""} onClick={() => setFilter("judicial")}>Juicios <span>{filterCounts.judicial}</span></button>}
              {canViewInsurance && <button type="button" className={filter === "insurance_active" ? "active" : ""} onClick={() => setFilter("insurance_active")}>Con reclamo activo <span>{filterCounts.insurance_active}</span></button>}
              {canViewInsurance && <button type="button" className={filter === "insurance_inactive" ? "active" : ""} onClick={() => setFilter("insurance_inactive")}>Sin número de reclamo <span>{filterCounts.insurance_inactive}</span></button>}
              <button type="button" className={filter === "finalized" ? "active" : ""} onClick={() => setFilter("finalized")} disabled={filterCounts.finalized === 0}>Finalizados <span>{filterCounts.finalized}</span></button>
            </div>
          </section>
          <section className="unified-incidents-filter-section unified-incidents-filter-section--priority" aria-labelledby="incident-priority-filter-title">
            <span className="unified-incidents-filter-title" id="incident-priority-filter-title">Prioridad operativa</span>
            <div className="unified-incidents-filters unified-incidents-filters--priority" aria-label="Filtrar por prioridad operativa">
              <button type="button" className={`priority-follow-up${filter === "action" ? " active" : ""}`} onClick={() => setFilter("action")}>Requieren seguimiento <span>{filterCounts.action}</span></button>
              <button type="button" className={`priority-urgent${filter === "urgent" ? " active" : ""}`} onClick={() => openAlertCenter("urgent")} disabled={filterCounts.urgent === 0}>Urgentes <span>{filterCounts.urgent}</span></button>
              <button type="button" className={`priority-attention${filter === "attention" ? " active" : ""}`} onClick={() => openAlertCenter("attention")} disabled={filterCounts.attention === 0}>Atención <span>{filterCounts.attention}</span></button>
              <button type="button" className={`priority-upcoming${filter === "upcoming" ? " active" : ""}`} onClick={() => openAlertCenter("upcoming")} disabled={filterCounts.upcoming === 0}>Próximos <span>{filterCounts.upcoming}</span></button>
            </div>
            <p className="unified-incidents-priority-note">Urgentes, Atención y Próximos forman parte de los <strong>{filterCounts.action} expedientes que requieren seguimiento</strong>; un expediente puede tener más de una alerta.</p>
          </section>
        </div>
        <details className="unified-incidents-advanced" open={advancedFiltersOpen} onToggle={(event) => setAdvancedFiltersOpen(event.currentTarget.open)}>
          <summary>Filtros avanzados{insurerFilter || dateFrom || dateTo ? " · activos" : ""}</summary>
          <div>
            <label>Aseguradora<select value={insurerFilter} onChange={(event) => setInsurerFilter(event.target.value)}><option value="">Todas</option>{insurerOptions.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}</select></label>
            <label>Incidente desde<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label>Incidente hasta<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
            <button type="button" className="button ghost small" onClick={() => { setInsurerFilter(""); setDateFrom(""); setDateTo(""); }} disabled={!insurerFilter && !dateFrom && !dateTo}>Limpiar adicionales</button>
          </div>
        </details>
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
          return <article key={incident.id} className={`unified-incident-card status-${claimState}${expanded ? " expanded" : ""}`}>
            <div className="unified-incident-row">
              <div className="unified-incident-summary" onClick={() => setExpandedId(expanded ? null : incident.id)}>
                <span className="unified-incident-identity"><strong>{incident.unit || "Sin unidad"} · {incident.driver || "Sin chofer"}</strong><small>Incidente {incident.incidentDate || "sin fecha"}{ageLabel ? ` · ${ageLabel}` : ""}</small></span>
                <span className="unified-incident-vehicle">
                  <span><small>Placa</small><strong>{incident.plate || "—"}</strong></span>
                  <span><small>Año</small><strong>{incident.vehicleYear || "—"}</strong></span>
                </span>
                <span className={`unified-incident-claim status-${claimState}`}>
                  <strong>{claimStateLabel}</strong>
                  {claimState === "inactive" && <small>Pendiente de número de reclamo</small>}
                  {claimState === "none" && <small>No se ha iniciado un reclamo</small>}
                  {incident.claim && claimState !== "inactive" && <span className="unified-incident-claim-reference">
                    <small>{incident.claim.claimNumber ? `N.º ${incident.claim.claimNumber}` : "Sin número"}</small>
                    {incident.claim.claimNumber && <button type="button" className="unified-claim-copy" aria-label={`Copiar número de reclamo ${incident.claim.claimNumber}`} title="Copiar número de reclamo" onClick={(event) => { event.stopPropagation(); void copyClaimNumber(incident.claim!); }}>{copiedClaimId === incident.claim.id ? "✓" : "⧉"}</button>}
                  </span>}
                  {incident.claim?.insurer && <small className="unified-incident-insurer">{incident.claim.insurer}</small>}
                  {incident.claim?.closureOutcome && <small className="unified-incident-outcome">{incident.claim.closureOutcome}</small>}
                </span>
                <span className={`unified-incident-action${incident.requiresAction ? " attention" : incident.finalized ? " complete" : ""}`}><small>Próxima acción</small><strong>{incident.nextAction}</strong></span>
                {topAlert && <span className={`unified-incident-alert severity-${topAlert.severity}`} role="status"><b>{topAlert.severity === "urgent" ? "!" : topAlert.severity === "attention" ? "⚠" : "◷"}</b> {topAlert.title}</span>}
                <button type="button" className="workflow-claim-chevron" aria-label={expanded ? "Contraer expediente" : "Expandir expediente"} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); setExpandedId(expanded ? null : incident.id); }}>{expanded ? "−" : "+"}</button>
              </div>
              <div className="unified-incident-quick-actions">
                {incident.collision && <button type="button" className="button" onClick={() => onOpen("judicial", { id: incident.collision!.id, search: incident.unit })}>Gestionar juicio</button>}
                {incident.claim && <button type="button" className="button primary" onClick={() => onOpen("insurance", { id: incident.claim!.id, search: incident.unit })}>Gestionar reclamo</button>}
                {incident.collision?.status === "Ganó" && !incident.claim && canViewInsurance && <button type="button" className="button primary" onClick={() => onOpen("judicial", { id: incident.collision!.id, search: incident.unit })}>Iniciar reclamo</button>}
              </div>
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
