const fs = require("node:fs");
const path = require("node:path");

const pendingPanel = fs.readFileSync(path.resolve(__dirname, "../src/pages/payments/PendingBankPanel.tsx"), "utf8");
const workflow = fs.readFileSync(path.resolve(__dirname, "../src/pages/payments/usePendingBankWorkflow.ts"), "utf8");
const incidents = fs.readFileSync(path.resolve(__dirname, "../src/pages/IncidentsControlPage.tsx"), "utf8");
const insurancePanel = fs.readFileSync(path.resolve(__dirname, "../src/pages/incidents/InsuranceBankPaymentsPanel.tsx"), "utf8");

if (!pendingPanel.includes("Enviar seleccionados a Seguros") || !pendingPanel.includes("selectedInsuranceFolios")) {
  throw new Error("Pendientes del banco debe permitir seleccionar varios movimientos y enviarlos juntos a Seguros.");
}

if (!pendingPanel.includes('className="pending-insurance-bulk"') || !pendingPanel.includes("selectedInsuranceItems.length === 0")) {
  throw new Error("La accion multiple de Seguros debe permanecer visible y deshabilitarse hasta seleccionar movimientos.");
}
if (!pendingPanel.includes("Enviar a Seguros") || !workflow.includes("forwardBankItemsToInsurance")) {
  throw new Error("Cada movimiento debe conservar también una acción individual para enviarlo a Seguros.");
}
if (!workflow.includes("technicalMessage") || !workflow.includes("errorRecord?.details")) {
  throw new Error("Los errores de Supabase deben mostrarse con su mensaje tecnico real.");
}
if (!workflow.includes("No se aplicarán a clientes ni generarán recibos")) {
  throw new Error("El flujo debe advertir que el envío no afecta clientes ni genera recibos.");
}
if (!incidents.includes("InsuranceBankPaymentsPanel") || !insurancePanel.includes("Sugerencias de expediente")) {
  throw new Error("Control de siniestros debe mostrar la bandeja y sugerencias de expedientes.");
}
if (!incidents.includes("incidents-control-tabs") || !incidents.includes("bankingPendingCount") || !incidents.includes("Integración bancaria")) {
  throw new Error("La integración bancaria debe ser una pestaña con contador de pendientes por revisar.");
}
if (!insurancePanel.includes("onPendingCountChange?.(pendingCount)")) {
  throw new Error("La bandeja bancaria debe informar su cantidad pendiente a la pestaña principal.");
}
if (!insurancePanel.includes("Devolver a Pagos") || !insurancePanel.includes("Desvincular")) {
  throw new Error("Seguros debe poder corregir una clasificación o vínculo equivocado.");
}
if (!insurancePanel.includes("Cómo identificarlo") || !insurancePanel.includes("Vincular este expediente") || !insurancePanel.includes("manualSearch")) {
  throw new Error("La vinculación debe explicar cómo elegir y permitir buscar expedientes por sus datos.");
}
if (!insurancePanel.includes("hasLinkableClaimData") || !insurancePanel.includes("número de expediente y monto registrados")) {
  throw new Error("Los expedientes sin número o monto no deben sugerirse ni ofrecerse para vinculación.");
}
if (!insurancePanel.includes("Ordenadas de mayor a menor similitud") || !insurancePanel.includes("Mejor sugerencia")) {
  throw new Error("La interfaz debe explicar el orden de similitud e identificar la mejor sugerencia.");
}

console.log("OK integración visual: selección múltiple, bandeja de seguros, vínculo y devolución.");
