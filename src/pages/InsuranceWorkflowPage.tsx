import { useMemo, useState } from "react";
import type { Client } from "../types";

type Responsibility = "unknown" | "yes" | "no";
type ClaimStatus = "open" | "trial" | "insurance" | "billing" | "paid" | "closed";
type WorkflowStep = {
  id: string;
  title: string;
  owner: string;
  detail: string;
  evidence: string;
  lane: "intake" | "trial" | "insurance" | "billing" | "payment";
};
type InsuranceCase = {
  id: string;
  unit: string;
  driverSnapshot: string;
  collisionDate: string;
  responsibility: Responsibility;
  status: ClaimStatus;
  currentStepId: string;
  insurer: string;
  claimNumber: string;
  ticketNumber: string;
  hearingDate: string;
  hearingPlace: string;
  followUpDate: string;
  amount: string;
  paymentMethod: "pending" | "check" | "ach";
  notes: string;
  createdAt: string;
  updatedAt: string;
};
type Draft = Omit<InsuranceCase, "id" | "createdAt" | "updatedAt">;

type Props = {
  clients: Client[];
};

const STORAGE_KEY = "cobrapp.module4.insurance_cases.v1";

const RESPONSIBILITY_LABEL: Record<Responsibility, string> = {
  unknown: "Si / no se sabe",
  yes: "Si, responsable",
  no: "No responsable"
};

const STATUS_LABEL: Record<ClaimStatus, string> = {
  open: "Abierto",
  trial: "Juicio",
  insurance: "Seguro",
  billing: "Factura",
  paid: "Pagado",
  closed: "Cerrado"
};

const LANE_LABELS: Record<WorkflowStep["lane"], string> = {
  intake: "Ingreso",
  trial: "Juicio",
  insurance: "Seguro / FUD",
  billing: "Factura",
  payment: "Pago"
};

const BASE_STEPS: WorkflowStep[] = [
  { id: "collision", title: "Registrar choque", owner: "Caja / Operaciones", detail: "Crear el expediente con unidad, conductor, placa, fecha, lugar, fotos y observacion inicial.", evidence: "Parte, fotos, unidad, conductor", lane: "intake" },
  { id: "responsibility", title: "Definir responsabilidad", owner: "Seguros", detail: "Confirmar si el conductor es responsable o si debe pasar por juicio para determinar resultado.", evidence: "Parte, declaracion, documentos", lane: "intake" }
];

const TRIAL_STEPS: WorkflowStep[] = [
  { id: "ticket", title: "Recibir colilla", owner: "Legal", detail: "Guardar numero de colilla, fecha, hora y lugar del juicio.", evidence: "Numero de colilla, fecha y juzgado", lane: "trial" },
  { id: "attend-trial", title: "Asistir al juicio", owner: "Legal / Conductor", detail: "Registrar asistencia y resultado: culpable o absuelto.", evidence: "Resolucion o constancia", lane: "trial" }
];

const RESPONSIBLE_STEPS: WorkflowStep[] = [
  { id: "damage-quote", title: "Cotizar danos", owner: "Taller", detail: "Realizar cotizacion del dano y dejar monto listo para facturacion.", evidence: "Cotizacion / factura taller", lane: "billing" },
  { id: "invoice", title: "Facturar danos", owner: "Administracion", detail: "Emitir factura al responsable por los danos de la unidad.", evidence: "Factura emitida", lane: "billing" },
  { id: "collect-driver", title: "Cobrar factura", owner: "Cobros", detail: "Dar seguimiento hasta que el conductor pague la factura.", evidence: "Recibo / pago aplicado", lane: "payment" }
];

const INSURANCE_STEPS: WorkflowStep[] = [
  { id: "fud", title: "Recibir FUD", owner: "Aseguradora", detail: "Recibir y archivar el FUD entregado por la aseguradora.", evidence: "FUD", lane: "insurance" },
  { id: "claim-number", title: "Recibir numero de reclamo", owner: "Seguros", detail: "Registrar numero de reclamo y aseguradora para seguimiento.", evidence: "Numero de reclamo", lane: "insurance" },
  { id: "settlement", title: "Recibir finiquito", owner: "Seguros", detail: "Validar el finiquito y determinar si el pago sera por cheque o ACH.", evidence: "Finiquito", lane: "insurance" },
  { id: "insurance-payment", title: "Cerrar seguimiento", owner: "Administracion", detail: "Concluir el caso una vez la aseguradora haga el pago.", evidence: "Cheque, ACH o comprobante", lane: "payment" }
];

function getSteps(responsibility: Responsibility): WorkflowStep[] {
  if (responsibility === "yes") return [...BASE_STEPS, ...RESPONSIBLE_STEPS];
  if (responsibility === "no") return [...BASE_STEPS, ...INSURANCE_STEPS];
  return [...BASE_STEPS, ...TRIAL_STEPS, ...RESPONSIBLE_STEPS, ...INSURANCE_STEPS];
}

function normalizeUnit(value: string): string {
  return value.trim().toUpperCase();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyDraft(): Draft {
  return {
    unit: "",
    driverSnapshot: "",
    collisionDate: todayKey(),
    responsibility: "unknown",
    status: "open",
    currentStepId: "collision",
    insurer: "",
    claimNumber: "",
    ticketNumber: "",
    hearingDate: "",
    hearingPlace: "",
    followUpDate: "",
    amount: "",
    paymentMethod: "pending",
    notes: ""
  };
}

function readCases(): InsuranceCase[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as InsuranceCase[] : [];
  } catch {
    return [];
  }
}

function writeCases(cases: InsuranceCase[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
}

function formatDateLabel(value: string): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-PA", { day: "2-digit", month: "short", year: "numeric" });
}

export default function InsuranceWorkflowPage({ clients }: Props) {
  const [cases, setCases] = useState<InsuranceCase[]>(() => readCases());
  const [draft, setDraft] = useState<Draft>(() => createEmptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [driverSource, setDriverSource] = useState<"empty" | "found" | "not_found">("empty");
  const [selectedStepId, setSelectedStepId] = useState<string>("collision");
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());
  const [message, setMessage] = useState<string>("");

  const steps = useMemo(() => getSteps(draft.responsibility), [draft.responsibility]);
  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? steps[0];
  const selectedStepIndex = steps.findIndex((step) => step.id === selectedStep.id);
  const nextStep = steps[Math.min(selectedStepIndex + 1, steps.length - 1)];
  const progressText = `${selectedStepIndex + 1} de ${steps.length}`;

  const calendarDays = useMemo(() => {
    const base = new Date(`${selectedDate}T00:00:00`);
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const leading = first.getDay();
    const items: Array<{ dateKey: string; day: number; events: InsuranceCase[] } | null> = [];
    for (let index = 0; index < leading; index += 1) items.push(null);
    for (let day = 1; day <= last.getDate(); day += 1) {
      const date = new Date(base.getFullYear(), base.getMonth(), day);
      const dateKey = date.toISOString().slice(0, 10);
      items.push({
        dateKey,
        day,
        events: cases.filter((item) => item.followUpDate === dateKey || item.hearingDate === dateKey)
      });
    }
    return items;
  }, [cases, selectedDate]);

  const selectedDateCases = useMemo(() => {
    return cases.filter((item) => item.followUpDate === selectedDate || item.hearingDate === selectedDate);
  }, [cases, selectedDate]);

  function updateDraft(patch: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function handleUnitChange(value: string): void {
    const unit = normalizeUnit(value);
    const matchedClient = clients.find((client) => normalizeUnit(client.unitId) === unit && client.status !== "archivado");
    updateDraft({ unit, driverSnapshot: matchedClient?.name ?? "" });
    setDriverSource(unit ? (matchedClient ? "found" : "not_found") : "empty");
  }

  function resetDraft(): void {
    setDraft(createEmptyDraft());
    setEditingId(null);
    setDriverSource("empty");
    setSelectedStepId("collision");
    setMessage("");
  }

  function saveDraft(): void {
    if (!draft.unit.trim()) {
      setMessage("La unidad es obligatoria.");
      return;
    }
    if (!draft.driverSnapshot.trim()) {
      setMessage("No se puede guardar sin conductor asociado a esa unidad.");
      return;
    }
    const now = new Date().toISOString();
    const currentStepId = steps.some((step) => step.id === selectedStepId) ? selectedStepId : draft.currentStepId;
    const nextCase: InsuranceCase = {
      ...draft,
      unit: normalizeUnit(draft.unit),
      driverSnapshot: draft.driverSnapshot.trim(),
      currentStepId,
      id: editingId ?? `insurance-${Date.now()}`,
      createdAt: editingId ? cases.find((item) => item.id === editingId)?.createdAt ?? now : now,
      updatedAt: now
    };
    const nextCases = editingId
      ? cases.map((item) => item.id === editingId ? nextCase : item)
      : [nextCase, ...cases];
    setCases(nextCases);
    writeCases(nextCases);
    setEditingId(nextCase.id);
    setDraft(nextCase);
    setSelectedStepId(currentStepId);
    setMessage("Expediente guardado.");
  }

  function openCase(item: InsuranceCase): void {
    setEditingId(item.id);
    setDraft(item);
    setSelectedStepId(item.currentStepId);
    setDriverSource("found");
    setMessage("Conductor cargado como snapshot historico del expediente.");
  }

  function deleteCase(id: string): void {
    const nextCases = cases.filter((item) => item.id !== id);
    setCases(nextCases);
    writeCases(nextCases);
    if (editingId === id) resetDraft();
  }

  return (
    <section className="insurance-workflow-page">
      <div className="panel insurance-workflow-header">
        <div>
          <span className="workflow-eyebrow">Seguros</span>
          <h2>Flujo de reclamos</h2>
          <p className="hint">Formulario operativo con expediente guardado, seguimiento y calendario.</p>
        </div>
        <div className="workflow-progress">
          <span>Paso activo</span>
          <strong>{progressText}</strong>
        </div>
      </div>

      <section className="panel workflow-form-panel">
        <div className="panel-head">
          <h2>{editingId ? "Editar expediente" : "Nuevo expediente"}</h2>
          <div className="workflow-form-actions">
            <button type="button" className="button ghost" onClick={resetDraft}>Nuevo</button>
            <button type="button" className="button primary" onClick={saveDraft}>Guardar expediente</button>
          </div>
        </div>
        {message && <p className="hint workflow-message">{message}</p>}
        <div className="workflow-form-grid">
          <label>
            Unidad
            <input value={draft.unit} onChange={(event) => handleUnitChange(event.target.value)} placeholder="Ej. B52" />
          </label>
          <label>
            Conductor del caso
            <input value={draft.driverSnapshot} readOnly placeholder="Se trae por unidad" />
            <span className={`workflow-driver-source workflow-driver-source--${driverSource}`}>
              {driverSource === "found"
                ? "Nombre copiado al expediente. No cambia si luego cambia el chofer."
                : driverSource === "not_found"
                  ? "No hay conductor activo para esa unidad."
                  : "Escribe la unidad para traer el conductor."}
            </span>
          </label>
          <label>
            Fecha de choque
            <input type="date" value={draft.collisionDate} onChange={(event) => updateDraft({ collisionDate: event.target.value })} />
          </label>
          <label>
            Estado
            <select value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as ClaimStatus })}>
              {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Aseguradora
            <input value={draft.insurer} onChange={(event) => updateDraft({ insurer: event.target.value.toUpperCase() })} placeholder="FEDPA, SURA..." />
          </label>
          <label>
            Reclamo
            <input value={draft.claimNumber} onChange={(event) => updateDraft({ claimNumber: event.target.value })} placeholder="Numero de reclamo" />
          </label>
          <label>
            Colilla
            <input value={draft.ticketNumber} onChange={(event) => updateDraft({ ticketNumber: event.target.value })} placeholder="Numero de colilla" />
          </label>
          <label>
            Fecha de juicio
            <input type="date" value={draft.hearingDate} onChange={(event) => updateDraft({ hearingDate: event.target.value })} />
          </label>
          <label>
            Lugar / juzgado
            <input value={draft.hearingPlace} onChange={(event) => updateDraft({ hearingPlace: event.target.value.toUpperCase() })} placeholder="Juan Diaz, San Miguelito..." />
          </label>
          <label>
            Proximo seguimiento
            <input type="date" value={draft.followUpDate} onChange={(event) => updateDraft({ followUpDate: event.target.value })} />
          </label>
          <label>
            Monto
            <input value={draft.amount} onChange={(event) => updateDraft({ amount: event.target.value })} placeholder="0.00" />
          </label>
          <label>
            Pago
            <select value={draft.paymentMethod} onChange={(event) => updateDraft({ paymentMethod: event.target.value as Draft["paymentMethod"] })}>
              <option value="pending">Pendiente</option>
              <option value="check">Cheque</option>
              <option value="ach">ACH</option>
            </select>
          </label>
          <label className="workflow-form-notes">
            Observaciones / seguimiento
            <textarea value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} placeholder="Notas del caso, documentos pendientes, acuerdos..." />
          </label>
        </div>
      </section>

      <section className="panel workflow-responsibility-panel">
        <span>Responsabilidad</span>
        <div>
          {(["unknown", "yes", "no"] as Responsibility[]).map((option) => (
            <button
              key={option}
              type="button"
              className={draft.responsibility === option ? "active" : ""}
              onClick={() => {
                updateDraft({ responsibility: option });
                setSelectedStepId("responsibility");
              }}
            >
              {RESPONSIBILITY_LABEL[option]}
            </button>
          ))}
        </div>
      </section>

      <div className="insurance-workflow-layout">
        <section className="panel workflow-map-panel">
          <div className="workflow-map">
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                className={`workflow-step workflow-step--${step.lane} ${selectedStep.id === step.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedStepId(step.id);
                  updateDraft({ currentStepId: step.id });
                }}
              >
                <span>{index + 1}</span>
                <div>
                  <small>{LANE_LABELS[step.lane]}</small>
                  <strong>{step.title}</strong>
                  <em>{step.owner}</em>
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="panel workflow-detail-panel">
          <div className="workflow-case-card">
            <span>Caso actual</span>
            <strong>{draft.unit || "Sin unidad"} {draft.driverSnapshot ? `- ${draft.driverSnapshot}` : ""}</strong>
            <small>{draft.claimNumber || draft.ticketNumber || "Sin reclamo/colilla"}</small>
          </div>
          <div className="workflow-detail-head">
            <span>{LANE_LABELS[selectedStep.lane]}</span>
            <h3>{selectedStep.title}</h3>
          </div>
          <p>{selectedStep.detail}</p>
          <dl className="workflow-detail-list">
            <div><dt>Responsable</dt><dd>{selectedStep.owner}</dd></div>
            <div><dt>Evidencia</dt><dd>{selectedStep.evidence}</dd></div>
            <div><dt>Siguiente</dt><dd>{nextStep.id === selectedStep.id ? "Cerrar expediente" : nextStep.title}</dd></div>
          </dl>
        </aside>
      </div>

      <div className="workflow-bottom-layout">
        <section className="panel workflow-cases-panel">
          <div className="panel-head">
            <h2>Expedientes guardados</h2>
            <span className="hint">{cases.length} casos</span>
          </div>
          <div className="workflow-case-list">
            {cases.length === 0 && <p className="hint">Todavia no hay expedientes guardados.</p>}
            {cases.map((item) => (
              <button key={item.id} type="button" className={editingId === item.id ? "active" : ""} onClick={() => openCase(item)}>
                <strong>{item.unit} - {item.driverSnapshot}</strong>
                <span>{STATUS_LABEL[item.status]} · {item.insurer || "Sin aseguradora"}</span>
                <small>Seguimiento: {formatDateLabel(item.followUpDate)} · Juicio: {formatDateLabel(item.hearingDate)}</small>
                <em onClick={(event) => { event.stopPropagation(); deleteCase(item.id); }}>Eliminar</em>
              </button>
            ))}
          </div>
        </section>

        <section className="panel workflow-calendar-panel">
          <div className="panel-head">
            <h2>Calendario de seguimiento</h2>
            <input type="month" value={selectedDate.slice(0, 7)} onChange={(event) => setSelectedDate(`${event.target.value}-01`)} />
          </div>
          <div className="workflow-calendar-weekdays">
            {["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="workflow-calendar-grid">
            {calendarDays.map((item, index) => item ? (
              <button key={item.dateKey} type="button" className={item.dateKey === selectedDate ? "active" : ""} onClick={() => setSelectedDate(item.dateKey)}>
                <span>{item.day}</span>
                {item.events.slice(0, 2).map((event) => <small key={event.id}>{event.unit}</small>)}
              </button>
            ) : <div key={`blank-${index}`} />)}
          </div>
          <div className="workflow-calendar-events">
            <strong>{formatDateLabel(selectedDate)}</strong>
            {selectedDateCases.length === 0 && <p className="hint">Sin seguimientos para esta fecha.</p>}
            {selectedDateCases.map((item) => (
              <button key={item.id} type="button" onClick={() => openCase(item)}>
                {item.unit} - {item.driverSnapshot}
                <span>{item.followUpDate === selectedDate ? "Seguimiento" : "Juicio"}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
