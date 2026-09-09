const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const helperSource = fs.readFileSync(path.join(root, "src/collisionDocumentation.ts"), "utf8");
const output = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `collision-documentation-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { getMissingCollisionDocumentation } = require(target);

const completeCase = {
  incidentDate: "2026-09-08",
  incidentLocation: "Vía España, frente al parque",
  unit: "B17",
  driver: "Cliente de prueba",
  plate: "AB1234",
  vehicleDamage: "Golpe en la puerta delantera",
  trialDate: "2026-09-20",
  ticketStub: "COL-123",
  placeTime: "09:00",
  court: "Juzgado de Tránsito"
};

if (getMissingCollisionDocumentation(completeCase).length !== 0) {
  throw new Error("Un expediente con todos los datos debe quedar documentalmente completo.");
}

const missingLocation = getMissingCollisionDocumentation({ ...completeCase, incidentLocation: "  " });
if (missingLocation.length !== 0) {
  throw new Error("El lugar de la colisión no debe ser obligatorio.");
}

const intake = fs.readFileSync(path.join(root, "src/pages/IncidentIntakeForm.tsx"), "utf8");
const control = fs.readFileSync(path.join(root, "src/pages/IncidentsControlPage.tsx"), "utf8");
const collisions = fs.readFileSync(path.join(root, "src/pages/CollisionsPage.tsx"), "utf8");
const navigation = fs.readFileSync(path.join(root, "src/pages/incidents/judicialCaseNavigation.ts"), "utf8");
const manualSql = fs.readFileSync(path.join(root, "supabase/81-remove-collision-location-requirement.sql"), "utf8");
const migrationSql = fs.readFileSync(path.join(root, "supabase/migrations/20260909000300_remove_collision_location_requirement.sql"), "utf8");

if (!intake.includes("Información pendiente para avanzar") || !intake.includes("incidentLocation")) {
  throw new Error("El registro inicial debe permitir guardar y mostrar la lista exacta de datos pendientes.");
}
if (!control.includes('Falta completar: ${missingDocumentation.join(", ")}')) {
  throw new Error("La confirmación posterior al guardado debe repetir exactamente qué información falta.");
}
if (!collisions.includes("No se puede concluir. Falta completar:") || !collisions.includes("Sí puedes guardar una nueva fecha de juicio.")) {
  throw new Error("La conclusión debe quedar bloqueada con una explicación exacta, sin bloquear la reprogramación.");
}
if (navigation.includes('if (item.documentationPending) return ["summary", "follow_up", "history"]')) {
  throw new Error("La documentación pendiente no debe bloquear las gestiones intermedias del expediente.");
}
if (manualSql !== migrationSql || !manualSql.includes("collision_case_completion_guard") || manualSql.includes("incidentLocation")) {
  throw new Error("La base de datos debe aplicar la misma barrera de conclusión y conservar copias SQL idénticas.");
}

console.log("OK documentación de colisiones: guardado parcial, faltantes exactos y conclusión protegida.");
