import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".tmp", "tests", "payments-tabs-csv-guard.cjs");
fs.mkdirSync(path.dirname(output), { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, "src/pages/payments/PaymentsTabs.tsx")],
  bundle: true,
  platform: "node",
  packages: "external",
  jsx: "automatic",
  outfile: output
});

const importedModule = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
const PaymentsTabs = importedModule.default.default ?? importedModule.default;
const baseProps = {
  activeTab: "register",
  onSelect: () => undefined,
  onImportCsv: () => undefined
};
const warning = "Debes hacer el cierre de caja del 6 de octubre de 2026 antes de importar el CSV.";
const blockedHtml = renderToStaticMarkup(React.createElement(PaymentsTabs, {
  ...baseProps,
  isCsvImportBlocked: true,
  csvImportBlockMessage: warning
}));
assert.match(blockedHtml, /<button[^>]*disabled=""[^>]*title="Debes hacer el cierre/);
assert.match(blockedHtml, /role="alert"/);
assert.match(blockedHtml, /antes de importar el CSV/);

const enabledHtml = renderToStaticMarkup(React.createElement(PaymentsTabs, baseProps));
const csvButton = enabledHtml.match(/<button[^>]*>Importar CSV<\/button>/)?.[0] ?? "";
assert.ok(csvButton);
assert.doesNotMatch(csvButton, /disabled/);

const pageSource = fs.readFileSync(path.join(root, "src/pages/PaymentsPage.tsx"), "utf8");
const hookSource = fs.readFileSync(path.join(root, "src/pages/payments/useCashClosing.ts"), "utf8");
const cloudSource = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
assert.match(pageSource, /await verifyDateClosedInCloud\(requiredCsvClosingDate\)/);
assert.ok(
  pageSource.indexOf("await verifyDateClosedInCloud(requiredCsvClosingDate)") < pageSource.indexOf("await handleImportBankCSV()"),
  "La verificación en nube debe ocurrir antes de abrir el CSV."
);
assert.match(hookSource, /isCloudCashClosingDateClosed\(ownerUserId, date\)/);
assert.match(hookSource, /isCashDayClosed\(date, ownerUserId\)/);
assert.ok(
  hookSource.indexOf("isDateClosedInCloud(requiredClosingDate, dataOwnerUserId)") < hookSource.indexOf("loadCashClosingCloudState(dataOwnerUserId).catch"),
  "La verificación puntual debe arrancar sin esperar la carga histórica."
);
assert.match(cloudSource, /if \(rows\.length > 0\) return rows;/);

console.log("OK CSV: cierre anterior validado por fecha sin esperar ni descargar el historial pesado.");
