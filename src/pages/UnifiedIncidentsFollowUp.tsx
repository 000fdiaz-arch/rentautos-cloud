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
};

type FollowUpFilter = "all" | "judicial" | "insurance" | "action" | "finalized";
const STALE_CLAIM_DAYS = 15;

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

function daysSince(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const elapsed = Date.now() - date.getTime();
  return elapsed < 0 ? 0 : Math.floor(elapsed / 86_400_000);
}

function calendarDaysSince(value: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const incidentDay = Date.UTC(year, month - 1, day);
  const parsedIncident = new Date(incidentDay);
  if (parsedIncident.getUTCFullYear() !== year || parsedIncident.getUTCMonth() !== month - 1 || parsedIncident.getUTCDate() !== day) return null;
  const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.floor((currentDay - incidentDay) / 86_400_000));
}

function incidentAgeLabel(value: string): string {
  const days = calendarDaysSince(value);
  if (days === null) return "";
  if (days === 0) return "Hoy";
  if (days === 1) return "Hace 1 día";
  return `Hace ${days} días`;
}

function staleClaimDays(claim: InsuranceClaimRecord | null): number | null {
  if (!claim || claim.status !== "Activo") return null;
  const lastUpdate = claim.followUpCommentUpdatedAt || claim.updatedAt || claim.createdAt;
  const days = daysSince(lastUpdate);
  return days !== null && days >= STALE_CLAIM_DAYS ? days : null;
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

export default function UnifiedIncidentsFollowUp({ dataOwnerUserId, canViewJudicial, canViewInsurance, refreshKey, onOpen }: Props) {
  const [collisions, setCollisions] = useState<CollisionCaseRecord[]>([]);
  const [claims, setClaims] = useState<InsuranceClaimRecord[]>([]);
  const [fleetUnits, setFleetUnits] = useState<ControlUnitRow[]>([]);
  const [filter, setFilter] = useState<FollowUpFilter>("all");
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
          const staleDays = staleClaimDays(incident.claim);
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
                {staleDays !== null && <span className="unified-incident-stale" role="status">⚠ {staleDays} días sin actualización</span>}
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
            </div>}
          </article>;
        })}
      </div>
    </section>
  );
}
