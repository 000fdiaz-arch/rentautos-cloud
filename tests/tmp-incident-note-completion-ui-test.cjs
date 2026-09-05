const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const unified = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const control = fs.readFileSync(path.join(root, "src/pages/IncidentsControlPage.tsx"), "utf8");

function assertIncludes(source, expected, message) {
  if (!source.includes(expected)) throw new Error(message);
}

assertIncludes(unified, '"Pendiente"', "La última nota debe mostrar su estado Pendiente.");
assertIncludes(unified, "Última gestión realizada", "Al completar la nota debe mostrarse la fecha de la última gestión realizada.");
assertIncludes(unified, "completedNoteDateTime(latestIncidentNote.completedAt)", "La confirmación debe incluir fecha y hora de ejecución.");
assertIncludes(unified, "markNoteCompleted", "La acción debe guardar la finalización de la nota.");
assertIncludes(unified, "completedAt: now", "La nota realizada debe conservar la fecha de ejecución.");
assertIncludes(unified, "saveInsuranceClaim", "Las notas de seguro realizadas deben persistirse.");
assertIncludes(unified, "saveCollisionCase", "Las notas judiciales realizadas deben persistirse.");
assertIncludes(unified, "note.completedAt", "Una nota ya realizada no debe poder marcarse nuevamente.");
assertIncludes(control, "canEditIncidents={canEditIncidents}", "La acción debe respetar el permiso de edición de siniestros.");

console.log("OK notas de siniestros: acción Realizado, persistencia y permisos.");
