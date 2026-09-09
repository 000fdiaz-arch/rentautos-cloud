const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const rulesSource = fs.readFileSync(path.join(root, "src/pages/incidents/pendingDestinationRules.ts"), "utf8");
const output = ts.transpileModule(rulesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `pending-destination-rules-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { isNextContactWithinOneDay, pendingDestinationEscalation } = require(target);

const now = new Date("2026-09-09T12:00:00Z");
const incident = (createdAt, attempts = 1) => ({
  createdAt,
  contactAttempts: Array.from({ length: attempts }, (_, index) => ({ id: String(index) }))
});

if (pendingDestinationEscalation(incident("2026-09-09T10:00:00Z"), now).level !== "new") throw new Error("La alerta debe aparecer inmediatamente.");
if (pendingDestinationEscalation(incident("2026-09-08T12:00:00Z"), now).level !== "attention") throw new Error("A las 24 horas debe escalar a atención.");
if (pendingDestinationEscalation(incident("2026-09-07T12:00:00Z"), now).level !== "urgent") throw new Error("A las 48 horas debe ser urgente.");
if (pendingDestinationEscalation(incident("2026-09-06T12:00:00Z"), now).level !== "supervisor") throw new Error("A las 72 horas debe escalar al supervisor.");
if (pendingDestinationEscalation(incident("2026-09-09T10:00:00Z", 3), now).level !== "supervisor") throw new Error("Tres intentos deben escalar al supervisor aunque no hayan pasado 72 horas.");
if (!isNextContactWithinOneDay("2026-09-10", now) || isNextContactWithinOneDay("2026-09-11", now)) throw new Error("La siguiente gestión solo puede programarse dentro de 24 horas.");

const intake = fs.readFileSync(path.join(root, "src/pages/IncidentIntakeForm.tsx"), "utf8");
const control = fs.readFileSync(path.join(root, "src/pages/IncidentsControlPage.tsx"), "utf8");
const unified = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const manager = fs.readFileSync(path.join(root, "src/pages/PendingIncidentDestinationPage.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");
const cloud = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
const manualSql = fs.readFileSync(path.join(root, "supabase/80-pending-incident-destination.sql"), "utf8");
const migrationSql = fs.readFileSync(path.join(root, "supabase/migrations/20260909000200_pending_incident_destination.sql"), "utf8");

if (!intake.includes("Todavía no se sabe") || !intake.includes("savePendingIncident")) throw new Error("El registro debe ofrecer y guardar el destino pendiente.");
if (!unified.includes("SUPER ALERTA · NO SE PUEDE DESCARTAR") || !unified.includes("pendingDestinationEscalation")) throw new Error("El control debe mostrar la super alerta persistente.");
if (!manager.includes("Registrar otro intento") || !manager.includes("Enviar a juicio") || !manager.includes("Enviar al seguro")) throw new Error("La gestión debe permitir intentos y resolución hacia ambas vías.");
if (!control.includes("PendingIncidentDestinationPage") || !cloud.includes('from("pending_incidents_cloud")')) throw new Error("El expediente neutral debe estar conectado al control y a la nube.");
if (!appShell.includes("loadPendingIncidents(cloudDataUserId)") || !appShell.includes("pendingDestinations")) throw new Error("La super alerta debe contar también en la insignia global de navegación.");
if (!manualSql.includes("pending_incidents_cloud") || !migrationSql.includes("pending_incidents_cloud") || !manualSql.includes("enable row level security") || !migrationSql.includes("enable row level security")) throw new Error("La tabla neutral debe incluir migración y RLS.");

console.log("OK destino pendiente: alerta inmediata, escalamiento 24/48/72h, tres intentos y conversión controlada.");
