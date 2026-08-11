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

type FollowUpFilter = "all" | "judicial" | "insurance" | "action" | "finalized";
type AlertFilter = "all" | "urgent" | "attention" | "upcoming" | "judicial" | "insurance";
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

    if (!claim.followUpComment.trim() && createdDays !== null && createdDays >= 3) {
      addAlert(incident, {
        id: `${incident.id}:first-follow-up-missing`, kind: "insurance", severity: "urgent", priority: 4,
        title: "Reclamo sin primer seguimiento", message: `El reclamo está activo desde hace ${createdDays} días y no tiene seguimiento registrado.`,
        actionLabel: "Registrar seguimiento", destination: "insurance", targetId: claim.id
      });
    } else if (claim.followUpComment.trim()) {
      const lastUpdate = claim.followUpCommentUpdatedAt || claim.updatedAt || claim.createdAt;
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
  if (!claim.followUpComment.trim()) return { label: "Registrar seguimiento del seguro", finalized: false, requiresAction: true };
  if (!claim.settlementDelivered) return { label: "Dar seguimiento y gestionar finiquito", finalized: false, requiresAction: false };
  return { label: "Finalizar reclamo", finalized: false, requiresAction: true };
}

function collisionNextAction(collision: CollisionCaseRecord, claim: InsuranceClaimRecord | null): { label: string; finalized: boolean; requiresAction: boolean } {
  if (collision.status === "Perdió") return { label: "Expediente judicial finalizado", finalized: true, requiresAction: false };
  if (collision.status === "Ganó") {
    if (claim) return claimNextAction(claim);
    return { label: "Iniciar reclamo al seguro", finalized: false, requiresAction: true };
  }
  const requiresResult = Boolean(collision.trialDate && collision.trialDate <= localDateKey());
  return requiresResult
    ? { label: "Registrar resultado del juicio", finalized: false, requiresAction: true }
    : { label: collision.trialDate ? `Esperar juicio del ${collision.trialDate}` : "Asignar fecha de juicio", finalized: false, requiresAction: !collision.trialDate };
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
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [alertCenterOpen, setAlertCenterOpen] = useState(false);
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
  const alertCounts = useMemo(() => ({
    urgent: alerts.filter((alert) => alert.severity === "urgent").length,
    attention: alerts.filter((alert) => alert.severity === "attention").length,
    upcoming: alerts.filter((alert) => alert.severity === "upcoming").length
  }), [alerts]);
  const activeAlertCount = alerts.length;
  const filteredAlerts = useMemo(() => alerts.filter((alert) => {
    if (alertFilter === "urgent") return alert.severity === "urgent";
    if (alertFilter === "attention") return alert.severity === "attention";
    if (alertFilter === "upcoming") return alert.severity === "upcoming";
    if (alertFilter === "judicial") return alert.kind === "judicial";
    if (alertFilter === "insurance") return alert.kind === "insurance";
    return true;
  }), [alertFilter, alerts]);
  const alertsByIncident = useMemo(() => {
    const grouped = new Map<string, IncidentAlert[]>();
    alerts.forEach((alert) => grouped.set(alert.incidentId, [...(grouped.get(alert.incidentId) ?? []), alert]));
    return grouped;
  }, [alerts]);

  useEffect(() => {
    onAlertCountChange?.(activeAlertCount);
  }, [activeAlertCount, onAlertCountChange]);
  const filteredIncidents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    return incidents.filter((incident) => {
      if (filter === "judicial" && !incident.collision) return false;
      if (filter === "insurance" && !incident.claim) return false;
      if (filter === "action" && !incident.requiresAction) return false;
      if (filter === "finalized" && !incident.finalized) return false;
      if (!needle) return true;
      return [incident.unit, incident.driver, incident.plate, incident.vehicleYear, incident.vehicleDamage, incident.nextAction,
        incident.claim?.claimNumber ?? "", incident.claim?.insurer ?? "", incident.claim?.status ?? ""]
        .some((value) => value.toLocaleLowerCase("es").includes(needle));
    });
  }, [filter, incidents, search]);

  const actionCount = incidents.filter((incident) => incident.requiresAction).length;

  function openAlert(alert: IncidentAlert): void {
    onOpen(alert.destination, { id: alert.targetId, search: alert.unit });
  }

  function openAlertCenter(nextFilter: Extract<AlertFilter, "urgent" | "attention" | "upcoming">): void {
    if (alertCenterOpen && alertFilter === nextFilter) {
      setAlertCenterOpen(false);
      return;
    }
    setAlertFilter(nextFilter);
    setAlertCenterOpen(true);
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
        <div className="incident-alert-summary" aria-label="Resumen de alertas activas">
          <button type="button" className={`incident-alert-metric severity-urgent${alertCenterOpen && alertFilter === "urgent" ? " active" : ""}`} aria-expanded={alertCenterOpen && alertFilter === "urgent"} aria-controls="incident-alert-panel" onClick={() => openAlertCenter("urgent")}><small>Urgentes</small><strong>{alertCounts.urgent}</strong><span>Requieren acción inmediata</span></button>
          <button type="button" className={`incident-alert-metric severity-attention${alertCenterOpen && alertFilter === "attention" ? " active" : ""}`} aria-expanded={alertCenterOpen && alertFilter === "attention"} aria-controls="incident-alert-panel" onClick={() => openAlertCenter("attention")}><small>Atención</small><strong>{alertCounts.attention}</strong><span>Necesitan seguimiento</span></button>
          <button type="button" className={`incident-alert-metric severity-upcoming${alertCenterOpen && alertFilter === "upcoming" ? " active" : ""}`} aria-expanded={alertCenterOpen && alertFilter === "upcoming"} aria-controls="incident-alert-panel" onClick={() => openAlertCenter("upcoming")}><small>Próximos</small><strong>{alertCounts.upcoming}</strong><span>Juicios en los siguientes 3 días</span></button>
        </div>
        {alertCenterOpen && <div className="incident-alert-panel" id="incident-alert-panel">
          <div className="incident-alert-panel-head">
            <div><span className="workflow-eyebrow">Prioridades operativas</span><h3 id="incident-alert-center-title">Centro de alertas</h3></div>
            <div className="incident-alert-panel-actions"><span className="hint">{filteredAlerts.length} {filteredAlerts.length === 1 ? "alerta" : "alertas"}</span><button type="button" className="incident-alert-close" aria-label="Cerrar centro de alertas" onClick={() => setAlertCenterOpen(false)}>Cerrar</button></div>
          </div>
          <div className="incident-alert-filters" aria-label="Filtrar alertas">
            <button type="button" className={alertFilter === "all" ? "active" : ""} onClick={() => setAlertFilter("all")}>Todas</button>
            <button type="button" className={alertFilter === "urgent" ? "active" : ""} onClick={() => setAlertFilter("urgent")}>Urgentes</button>
            <button type="button" className={alertFilter === "attention" ? "active" : ""} onClick={() => setAlertFilter("attention")}>Atención</button>
            <button type="button" className={alertFilter === "upcoming" ? "active" : ""} onClick={() => setAlertFilter("upcoming")}>Próximas</button>
            {canViewJudicial && <button type="button" className={alertFilter === "judicial" ? "active" : ""} onClick={() => setAlertFilter("judicial")}>Juicios</button>}
            {canViewInsurance && <button type="button" className={alertFilter === "insurance" ? "active" : ""} onClick={() => setAlertFilter("insurance")}>Reclamos</button>}
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
      <div className="unified-incidents-toolbar">
        <label className="workflow-claim-search">Buscar<input type="search" value={search} placeholder="Unidad, placa, año, aseguradora o número de reclamo" onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="unified-incidents-filters" aria-label="Filtrar expedientes">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos</button>
          {canViewJudicial && <button type="button" className={filter === "judicial" ? "active" : ""} onClick={() => setFilter("judicial")}>Juicios</button>}
          {canViewInsurance && <button type="button" className={filter === "insurance" ? "active" : ""} onClick={() => setFilter("insurance")}>Reclamos</button>}
          <button type="button" className={filter === "action" ? "active" : ""} onClick={() => setFilter("action")}>Requieren acción{actionCount ? ` (${actionCount})` : ""}</button>
          <button type="button" className={filter === "finalized" ? "active" : ""} onClick={() => setFilter("finalized")}>Finalizados</button>
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
