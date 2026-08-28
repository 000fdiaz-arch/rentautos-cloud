import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReceiptCardContent } from "../src/components/PaymentReceipt";
import type { Payment } from "../src/types";

const payment: Payment = {
  id: "advance-clarity-test",
  receiptNumber: "REC-TEST",
  clientId: "client-test",
  clientName: "CLIENTE DE PRUEBA",
  clientUnit: "B66",
  dateApplied: "2026-08-17",
  paymentMethod: "Efectivo",
  amountReceived: 25.66,
  appliedToRent: 0,
  centavosAhorro: 0.66,
  advanceApplied: 25,
  advanceBalanceAfter: 26,
  installmentsDeducted: 0,
  installmentsFromDebt: 0,
  installmentsFromAdvance: 0,
  balanceBefore: 0,
  balanceAfter: 0,
  savingsBefore: 21.12,
  savingsAfter: 21.78,
  installmentsPaidAfter: 57,
  installmentsRemainingAfter: 126,
  rentAmount: 204,
  frequency: "weekly",
  weeklyChargeDay: "monday",
  createdAt: "2026-08-17T12:00:00.000Z"
};

const markup = renderToStaticMarkup(<ReceiptCardContent payment={payment} format="history" />);
const text = markup
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function requireText(value: string): void {
  if (!text.includes(value)) throw new Error(`Falta texto obligatorio: ${value}\n${text}`);
}

requireText("PAGO ADELANTADO");
requireText("7 DÍAS ANTES");
requireText("Aplicado por adelantado a la cuota del lunes 24 de agosto.");
requireText("Aplicación del adelanto");
requireText("Cuota futura · Lunes 24 de agosto");
requireText("Abono adelantado parcial");
requireText("Acumulado $26.00");
requireText("Restante de la cuota futura Aún no está vencida $178.00");
requireText("Fecha límite de esta cuota Lunes 24 de agosto");

if (/ahorro/i.test(text)) throw new Error(`El recibo no debe mencionar ahorro.\n${text}`);
if (text.includes("Saldo pendiente")) throw new Error(`Un adelanto futuro no debe presentarse como saldo pendiente.\n${text}`);
if ((text.match(/\$178\.00/g) ?? []).length !== 1) {
  throw new Error(`El restante futuro debe aparecer una sola vez.\n${text}`);
}

console.log("OK recibo adelantado: mensaje, acumulado y restante futuro claros; sin información de ahorro.");

if (process.env.RECEIPT_QA_HTML === "1") {
  const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
  writeFileSync(
    join(process.cwd(), ".tmp", "payment-receipt-advance-clarity.html"),
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="receipt-page"><div class="receipt-export-frame"><div class="receipt-card receipt-card--history receipt-card--image-export">${markup}</div></div></div></body></html>`
  );
}
