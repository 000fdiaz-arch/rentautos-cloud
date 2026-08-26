const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/CollisionsPage.tsx"), "utf8");

const requirements = [
  ['newTrialTimes[item.id]', "la hora de la nueva fecha"],
  ['rescheduleEvidenceFiles[item.id]', "el documento de respaldo"],
  ['Documento que avala la nueva fecha', "el campo de documento"],
  ['accept="application/pdf,image/*,.pdf"', "la aceptación de PDF o imagen"],
  ['placeTime: nextTime', "la actualización de la hora vigente"],
  ['evidence: uploadedEvidence', "la evidencia guardada en el historial"]
];

for (const [fragment, description] of requirements) {
  if (!source.includes(fragment)) throw new Error(`Falta ${description} en la reprogramación judicial.`);
}

if (!source.includes('!nextDate || nextDate === item.trialDate || !nextTime || !reason || !evidenceFile')) {
  throw new Error("La nueva fecha, hora, razón y evidencia deben validarse juntas antes de guardar.");
}

console.log("OK reprogramación judicial: exige nueva fecha, hora, razón y documento de respaldo.");
