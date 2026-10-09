const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
const card = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");

assert(page.includes("paymentReviewItems.length"), "La pestaña debe usar el total combinado.");
assert(page.includes("...partialReviewItems.filter"), "Los pagos parciales deben entrar primero en la lista combinada.");
assert(page.includes("...notifiedReviewItems"), "Los pagos notificados deben compartir la lista combinada.");
assert(page.includes("notifiedKeys.has"), "Un pago notificado debe evitar duplicar la misma publicación como parcial.");
assert(page.includes('left.reviewKind === "partial" ? -1 : 1'), "Los parciales deben conservar prioridad visual.");
assert(page.includes('item.reviewKind === "partial" ? "partial" : workflowView'), "Cada tarjeta debe conservar sus acciones originales.");
assert(!page.includes("'Pagos parciales a revisar', partialReviewItems.length"), "No debe quedar una pestaña separada para parciales.");
assert(card.includes("Pago notificado ·"), "Las tarjetas notificadas deben identificarse dentro de la lista combinada.");
assert(card.includes('view === "partial"') && card.includes("Decisión pendiente"), "Las tarjetas parciales deben conservar su decisión pendiente.");

console.log("tmp-route-combined-payment-review-test: ok");
