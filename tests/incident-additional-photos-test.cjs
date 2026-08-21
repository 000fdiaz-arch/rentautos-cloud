const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../src/pages/CollisionsPage.tsx"), "utf8");
const addStart = source.indexOf("async function addIncidentPhotos");
const deleteStart = source.indexOf("async function deleteIncidentPhoto");
const saveEditStart = source.indexOf("async function saveCaseEdit");
const addHandler = source.slice(addStart, deleteStart);
const deleteHandler = source.slice(deleteStart, saveEditStart);

if (addStart < 0 || deleteStart < 0 || saveEditStart < 0) throw new Error("Faltan las acciones independientes para fotos del siniestro.");
if (!addHandler.includes("incidentPhotos: [...(item.incidentPhotos ?? []), ...uploaded]")) throw new Error("Las fotos nuevas deben anexarse sin reemplazar las existentes.");
if (addHandler.includes("documentationPending:") || addHandler.includes("status:")) throw new Error("Agregar fotos no debe completar la colilla ni cambiar el estado judicial.");
if (!deleteHandler.includes("window.confirm") || !deleteHandler.includes("removeCollisionPhotos([photo.path])")) throw new Error("Eliminar una foto debe pedir confirmación y retirarla del almacenamiento.");
if (!source.includes("Agrega evidencia en cualquier momento. Esto no completa la colilla ni cambia el estado del expediente.")) throw new Error("La interfaz debe explicar que las fotos son independientes de la colilla.");
if (!source.includes('multiple hidden') || !source.includes('"Agregar fotos"')) throw new Error("Debe existir carga múltiple visible desde el resumen.");
if (!addHandler.includes('changedFields: ["Fotos del siniestro"]') || !deleteHandler.includes('changedFields: ["Fotos del siniestro"]')) throw new Error("Las altas y eliminaciones deben quedar en el historial.");

console.log("OK fotos adicionales: carga múltiple, historial y eliminación sin alterar la colilla.");
