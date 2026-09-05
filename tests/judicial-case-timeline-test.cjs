const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/incidents/judicialCaseTimeline.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `judicial-case-timeline-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { buildJudicialCaseTimeline } = require(target);

const events = buildJudicialCaseTimeline({
  id: "case-1",
  unit: "B17",
  createdAt: "2026-08-01T08:00:00Z",
  updatedAt: "2026-08-15T16:00:00Z",
  trialDate: "2026-08-31",
  trialDateHistory: [{
    previousDate: "2026-08-17",
    newDate: "2026-08-31",
    previousTime: "08:00",
    newTime: "10:30",
    reason: "Reprogramado por el juzgado",
    changedAt: "2026-08-05T09:00:00Z",
    evidence: { path: "reprogramacion.pdf", name: "reprogramacion.pdf" }
  }],
  ticketStubHistory: [{
    previousValue: "T07",
    newValue: "T08",
    changedAt: "2026-08-06T09:30:00Z"
  }],
  vehicleInspectionDate: "2026-08-09",
  vehicleInspectedAt: "2026-08-09T09:00:00Z",
  attendanceConfirmedAt: "2026-08-10T10:00:00Z",
  clientWillAttend: true,
  legalAssistanceRequested: false,
  judicialFollowUps: [{
    id: "note-1",
    comment: "Se llamó al juzgado.",
    nextStep: "Confirmar recepción",
    nextActionDate: "2026-08-16",
    createdAt: "2026-08-11T11:00:00Z"
  }],
  expenseInvoice: {
    chargeId: "charge-1",
    label: "Reparación",
    description: "Reparación de puerta",
    amount: 250,
    createdAt: "2026-08-12T12:00:00Z",
    creditedToRentAt: "2026-08-14T14:00:00Z",
    creditedToRentAmount: 250,
    attachment: { path: "invoice.pdf" }
  },
  status: "ABSUELTO",
  judicialResolutionSearchDate: "2026-09-14",
  clientReturnedBeforeClosure: false,
  judicialOutcomeEvidence: null,
  judicialResolutionEvidence: {
    path: "resolution.jpg",
    name: "resolucion.jpg",
    uploadedAt: "2026-08-13T13:00:00Z"
  },
  insuranceClaim: {
    insuranceClaimId: "claim-1",
    claimNumber: "REC-123",
    insurer: "Aseguradora Demo",
    updatedAt: "2026-08-15T15:00:00Z"
  }
});

const expectedTitles = [
  "Expediente creado",
  "Fecha de juicio actualizada",
  "Número de colilla corregido",
  "Vehículo recibido y revisado",
  "Asistencia confirmada",
  "Nota agregada",
  "Saldo de colisión registrado",
  "Saldo trasladado a la letra",
  "Resultado del juicio: ABSUELTO",
  "Resolución judicial adjuntada",
  "Reclamo al seguro actualizado"
];

for (const title of expectedTitles) {
  if (!events.some((event) => event.title === title)) {
    throw new Error(`Falta el evento: ${title}`);
  }
}

const outcomeEvent = events.find((event) => event.title === "Resultado del juicio: ABSUELTO");
if (outcomeEvent?.detail !== "La búsqueda de la resolución judicial quedó programada para el 2026-09-14.") {
  throw new Error("El historial no muestra la fecha programada para buscar la resolución judicial.");
}

const rescheduleEvent = events.find((event) => event.title === "Fecha de juicio actualizada");
if (rescheduleEvent?.description !== "2026-08-17 · 08:00 → 2026-08-31 · 10:30") {
  throw new Error("El historial no muestra la hora anterior y la nueva hora del juicio.");
}
if (!rescheduleEvent.detail?.includes("Documento adjunto: reprogramacion.pdf")) {
  throw new Error("El historial no identifica el documento que avala la reprogramación.");
}

for (let index = 1; index < events.length; index += 1) {
  if (events[index - 1].occurredAt < events[index].occurredAt) {
    throw new Error("El historial no está ordenado del evento más reciente al más antiguo.");
  }
}

console.log("OK historial judicial: reúne todos los eventos y los ordena del más reciente al más antiguo.");

const administrativeEvents = buildJudicialCaseTimeline({
  id: "case-administrative",
  unit: "D21",
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-04T10:00:00Z",
  trialDate: "",
  trialDateHistory: [],
  ticketStubHistory: [],
  editHistory: [],
  judicialFollowUps: [],
  expenseInvoice: null,
  status: "CIERRE ADMINISTRATIVO",
  judicialOutcomeEvidence: null,
  judicialResolutionEvidence: null,
  insuranceClaim: null,
  administrativeClosureHistory: [{
    action: "CERRADO",
    reason: "No fue posible presentar la denuncia porque el vehículo fue retirado al conductor.",
    occurredAt: "2026-09-04T10:00:00Z"
  }]
});
const administrativeEvent = administrativeEvents.find((event) => event.title === "Cierre administrativo");
if (!administrativeEvent || !administrativeEvent.description.includes("vehículo fue retirado")) {
  throw new Error("El historial debe conservar la razón del cierre administrativo.");
}
