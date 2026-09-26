const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/CollisionsPage.tsx"), "utf8");

const requirements = [
  ['aria-label="Hora del juicio"', "el control directo para la hora"],
  ['onClick={() => void saveTrialTime(item)}', "el guardado directo de la hora"],
  ['"Hora del juicio actualizada correctamente."', "la confirmación al actualizar la hora"],
  ['void saveTicketStubPhoto(item, file)', "la carga directa de la foto de la colilla"],
  ['item.ticketStubPhoto ? "Reemplazar foto" : "Adjuntar foto"', "la acción clara para adjuntar o reemplazar"],
  ['file.size > MAX_PHOTO_SIZE', "la validación de tamaño del archivo"],
  ['removeCollisionPhotos([item.ticketStubPhoto.path])', "la limpieza de la foto reemplazada"]
];

for (const [fragment, description] of requirements) {
  if (!source.includes(fragment)) throw new Error(`Falta ${description}.`);
}

console.log("OK edición rápida judicial: permite cambiar hora y adjuntar o reemplazar la colilla desde el resumen.");
