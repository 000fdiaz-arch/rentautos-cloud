import { useEffect, useMemo, useState } from "react";
import {
  loadPendingIncidents,
  saveCollisionCase,
  saveInsuranceClaim,
  savePendingIncident,
  type CollisionCaseRecord,
  type InsuranceClaimRecord,
  type PendingIncidentContactAttempt,
  type PendingIncidentRecord
} from "../cloudData";
import { isNextContactWithinOneDay, pendingDestinationEscalation, todayDateKey, tomorrowDateKey } from "./incidents/pendingDestinationRules";

type Props = {
  dataOwnerUserId?: string | null;
  incidentId: string;
  readOnly: boolean;
  onResolved: (destination: "judicial" | "insurance", targetId: string) => void;
};

export default function PendingIncidentDestinationPage({ dataOwnerUserId, incidentId, readOnly, onResolved }: Props) {
  const [incident, setIncident] = useState<PendingIncidentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<PendingIncidentContactAttempt["channel"]>("Llamada");
  const [outcome, setOutcome] = useState<PendingIncidentContactAttempt["outcome"]>("No responde");
  const [comment, setComment] = useState("");
  const [nextContactDate, setNextContactDate] = useState(tomorrowDateKey());

  useEffect(() => {
    if (!dataOwnerUserId) { setLoading(false); setMessage("No se encontró el owner de datos."); return; }
    let cancelled = false;
    setLoading(true);
    loadPendingIncidents(dataOwnerUserId, true)
      .then((items) => { if (!cancelled) setIncident(items.find((item) => item.id === incidentId) ?? null); })
      .catch((error) => { console.error("No se pudo cargar el destino pendiente.", error); if (!cancelled) setMessage("No se pudo cargar el expediente."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dataOwnerUserId, incidentId]);

  const escalation = useMemo(() => incident ? pendingDestinationEscalation(incident) : null, [incident]);

  async function registerAttempt(): Promise<void> {
    if (!dataOwnerUserId || !incident || readOnly || saving) return;
    if (!comment.trim()) { setMessage("Escribe el detalle del intento de contacto."); return; }
    if (!isNextContactWithinOneDay(nextContactDate)) { setMessage("La próxima gestión debe quedar programada para hoy o mañana."); return; }
    const now = new Date().toISOString();
    const attempt: PendingIncidentContactAttempt = {
      id: `contact-${crypto.randomUUID()}`, occurredAt: now, channel, outcome,
      comment: comment.trim(), nextContactDate
    };
    const updated = { ...incident, contactAttempts: [...incident.contactAttempts, attempt], nextContactDate, updatedAt: now };
    setSaving(true); setMessage("");
    try {
      await savePendingIncident(dataOwnerUserId, updated);
      setIncident(updated);
      setComment("");
      setMessage("Intento registrado. La alerta seguirá activa hasta definir el destino.");
    } catch (error) {
      console.error("No se pudo registrar el intento de contacto.", error);
      setMessage("No se pudo guardar el intento de contacto.");
    } finally { setSaving(false); }
  }

  async function resolveDestination(destination: "judicial" | "insurance"): Promise<void> {
    if (!dataOwnerUserId || !incident || readOnly || saving || incident.status !== "PENDING_DESTINATION") return;
    const now = new Date().toISOString();
    const targetId = `${incident.id}-${destination}`;
    setSaving(true); setMessage("");
    try {
      if (destination === "judicial") {
        const collision: CollisionCaseRecord = {
          id: targetId, incidentDate: incident.incidentDate, incidentLocation: incident.incidentLocation ?? "",
          unit: incident.unit, driver: incident.driver, clientId: "", clientName: incident.driver, plate: incident.plate,
          trialDate: "", vehicleDamage: incident.vehicleDamage, ticketStub: "", ticketStubPhoto: null,
          documentationPending: true, documentationPendingSince: now, documentationReceivedAt: null,
          placeTime: "", court: "", collisionAndRun: false, status: "PENDIENTE", trialDateHistory: [], editHistory: [],
          judicialFollowUps: incident.contactAttempts.map((attempt) => ({
            id: attempt.id, comment: `${attempt.channel} · ${attempt.outcome}: ${attempt.comment}`,
            nextStep: "Seguimiento realizado mientras el destino estaba pendiente", nextActionDate: attempt.nextContactDate,
            createdAt: attempt.occurredAt, completedAt: attempt.occurredAt,
            completionComment: "Gestión histórica previa a definir la vía judicial."
          })),
          clientWillAttend: null, legalAssistanceRequested: null, attendanceConfirmedAt: null,
          incidentPhotos: incident.incidentPhotos, judicialOutcomeEvidence: null, judicialResolutionEvidence: null,
          judicialResolutionSearchDate: null, insuranceClaim: null, expenseInvoice: null,
          clientReturnedBeforeClosure: false, clientReturnedBeforeClosureAt: null,
          administrativeClosureReason: "", administrativelyClosedAt: null, administrativeClosureHistory: [],
          createdAt: incident.createdAt, updatedAt: now
        };
        await saveCollisionCase(dataOwnerUserId, collision);
      } else {
        const claim: InsuranceClaimRecord = {
          id: targetId, incidentDate: incident.incidentDate, unit: incident.unit, driver: incident.driver,
          plate: incident.plate, insurer: "", hasClaimNumber: false, claimNumber: "", amount: "",
          vehicleDamage: incident.vehicleDamage, status: "Inactivo",
          damagePhotoNames: incident.incidentPhotos.map((photo) => photo.name), damagePhotos: incident.incidentPhotos,
          fudAttachment: null, fudPhysicalDeliveryConfirmed: false, fudPhysicalDeliveryDate: null,
          fudPhysicalDeliveryConfirmedAt: null, documentationPending: true, documentationPendingSince: now,
          documentationReceivedAt: null, settlementDelivered: false, settlementDeliveredDate: "",
          settlementMarkedAt: null, settlementAttachment: null, followUpComment: "", followUpCommentUpdatedAt: null,
          followUps: incident.contactAttempts.map((attempt) => ({
            id: attempt.id, comment: `${attempt.channel} · ${attempt.outcome}: ${attempt.comment}`,
            nextStep: "Seguimiento realizado mientras el destino estaba pendiente", nextActionDate: attempt.nextContactDate,
            createdAt: attempt.occurredAt, completedAt: attempt.occurredAt,
            completionComment: "Gestión histórica previa a definir el reclamo al seguro."
          })),
          closureOutcome: null, closureJustification: "", finalizedAt: null, editHistory: [],
          createdAt: incident.createdAt, updatedAt: now
        };
        await saveInsuranceClaim(dataOwnerUserId, claim);
      }
      const routed: PendingIncidentRecord = {
        ...incident, status: "ROUTED", resolvedDestination: destination, resolvedTargetId: targetId,
        resolvedAt: now, updatedAt: now
      };
      await savePendingIncident(dataOwnerUserId, routed);
      setIncident(routed);
      onResolved(destination, targetId);
    } catch (error) {
      console.error("No se pudo definir el destino del siniestro.", error);
      setMessage("No se pudo definir el destino. El caso continúa en la alerta; intenta nuevamente.");
    } finally { setSaving(false); }
  }

  if (loading) return <p className="hint workflow-message">Cargando expediente...</p>;
  if (!incident) return <p className="hint workflow-message">No se encontró este expediente pendiente.</p>;

  return <section className="pending-destination-management">
    {escalation && <div className={`pending-destination-super-alert level-${escalation.level}`} role="alert">
      <strong>{escalation.title}</strong><span>{escalation.message}</span>
      <small>{incident.contactAttempts.length} {incident.contactAttempts.length === 1 ? "intento registrado" : "intentos registrados"} · Próxima gestión: {incident.nextContactDate || "sin fecha"}</small>
    </div>}
    {message && <p className="hint workflow-message" role="status">{message}</p>}
    <dl className="workflow-claim-detail-grid">
      <div><dt>Unidad / placa</dt><dd>{incident.unit} / {incident.plate}</dd></div>
      <div><dt>Conductor</dt><dd>{incident.driver}</dd></div>
      <div><dt>Fecha del incidente</dt><dd>{incident.incidentDate}</dd></div>
      <div className="workflow-claim-damage"><dt>Daños</dt><dd>{incident.vehicleDamage}</dd></div>
    </dl>
    <section className="pending-destination-attempts">
      <h3>Historial de contacto</h3>
      <ol>{[...incident.contactAttempts].reverse().map((attempt) => <li key={attempt.id}><strong>{attempt.channel} · {attempt.outcome}</strong><span>{attempt.comment}</span><small>{new Date(attempt.occurredAt).toLocaleString("es-PA")} · Próximo: {attempt.nextContactDate}</small></li>)}</ol>
    </section>
    {!readOnly && incident.status === "PENDING_DESTINATION" && <section className="pending-destination-form">
      <h3>Registrar otro intento</h3>
      <div className="workflow-form-grid">
        <label>Medio<select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option>Llamada</option><option>WhatsApp</option><option>SMS</option><option>Correo</option><option>Otro</option></select></label>
        <label>Resultado<select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option>No responde</option><option>Contactado, pendiente de confirmar</option><option>Número inválido</option><option>Otro</option></select></label>
        <label className="workflow-form-notes">Detalle<textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Describe qué ocurrió en este intento." /></label>
        <label>Próxima gestión<input type="date" min={todayDateKey()} max={tomorrowDateKey()} value={nextContactDate} onChange={(event) => setNextContactDate(event.target.value)} /></label>
      </div>
      <button type="button" className="button" onClick={() => void registerAttempt()} disabled={saving || !comment.trim()}>Registrar intento</button>
    </section>}
    <section className="pending-destination-resolution">
      <div><h3>Definir destino final</h3><p>La alerta solo se cerrará al seleccionar una de estas dos vías.</p></div>
      <button type="button" className="button primary" disabled={readOnly || saving || incident.status !== "PENDING_DESTINATION"} onClick={() => void resolveDestination("judicial")}>Enviar a juicio</button>
      <button type="button" className="button primary" disabled={readOnly || saving || incident.status !== "PENDING_DESTINATION"} onClick={() => void resolveDestination("insurance")}>Enviar al seguro</button>
    </section>
  </section>;
}
