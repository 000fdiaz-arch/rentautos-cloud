import type { ChargeCloseReport } from "./paymentTypes";

export function escapeCsvCell(value: string | number | boolean): string {
  const raw = String(value ?? "");
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

export function downloadChargeCloseReportCsv(report: ChargeCloseReport): void {
  const header = [
    "unidad",
    "cliente",
    "debia_cobrar",
    "cobrado",
    "anomalia",
    "motivo",
    "saldo_antes",
    "saldo_despues",
    "monto_cargado",
    "lastCharge_antes",
    "lastCharge_despues"
  ];
  const rows = report.rows.map((row) => [
    row.unitId,
    row.name,
    row.shouldCharge ? "si" : "no",
    row.charged ? "si" : "no",
    row.anomaly ? "si" : "no",
    row.reason,
    row.balanceBefore.toFixed(2),
    row.balanceAfter.toFixed(2),
    row.chargedAmount.toFixed(2),
    row.lastChargeDateBefore,
    row.lastChargeDateAfter
  ]);
  const csv = [header, ...rows].map((line) => line.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `cierre-${report.closingDate}-a-${report.targetDate}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
