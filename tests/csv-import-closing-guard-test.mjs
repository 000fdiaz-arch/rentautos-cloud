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
assert.match(pageSource, /await verifyDateClosedInCloud\(requiredCsvClosingDate\)/);
assert.ok(
  pageSource.indexOf("await verifyDateClosedInCloud(requiredCsvClosingDate)") < pageSource.indexOf("await handleImportBankCSV()"),
  "La verificación en nube debe ocurrir antes de abrir el CSV."
);

console.log("OK CSV: bloqueado con alerta hasta cerrar el día anterior y revalidado en nube antes de importar.");
