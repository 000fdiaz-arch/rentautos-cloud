import { formatCurrency } from "../../format";
import type { ReceivableRow } from "../../receivables";
import type { CollectionStatusRecord, RouteExportFormat } from "./receivablesTypes";

type Options = {
  rows: ReceivableRow[];
  statusByClient: Record<string, CollectionStatusRecord>;
  format: RouteExportFormat;
  now: Date;
};

function lateInstallmentsLabel(totalPending: number, rentAmount: number): string {
  if (rentAmount <= 0) return "0";
  const installments = Math.ceil(totalPending / rentAmount);
  if (installments <= 0) return "0";
  return installments === 1 ? "1 cuota" : `${installments} cuotas`;
}

function routeRows(options: Options) {
  return options.rows
    .filter((row) => {
      const management = options.statusByClient[row.id];
      return Boolean(management?.managementType && management.managementAmount && management.managementAmount > 0);
    })
    .sort((left, right) => left.unitId.localeCompare(right.unitId));
}

function rowData(row: ReceivableRow, statusByClient: Record<string, CollectionStatusRecord>) {
  const management = statusByClient[row.id];
  return {
    unit: row.unitId,
    client: row.name,
    installments: `${formatCurrency(row.totalPending)} (${lateInstallmentsLabel(row.totalPending, row.rentAmount)})`,
    type: management?.managementType === "solo_cobrar" ? "Solo cobrar" : "Cobrar/quitar",
    amount: management?.managementAmount ?? 0,
    comment: (management?.managementComment ?? "").trim().slice(0, 25) || "-",
    managementType: management?.managementType
  };
}

async function exportPdf(options: Options, rows: ReceivableRow[]): Promise<void> {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);
  const doc = new JsPDF({ orientation: "landscape", format: "a4" });
  autoTable(doc, {
    head: [["Unidad", "Cliente", "Cuotas", "Tipo", "Monto", "Coment."]],
    body: rows.map((row) => {
      const data = rowData(row, options.statusByClient);
      return [data.unit, data.client, data.installments, data.type, formatCurrency(data.amount), data.comment];
    }),
    startY: 14,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] }
  });
  doc.save(`lista-cobro-en-ruta-${options.now.toISOString().slice(0, 10)}.pdf`);
}

async function exportExcel(options: Options, rows: ReceivableRow[]): Promise<void> {
  const xlsx = await import("xlsx");
  const dataRows = rows.map((row) => {
    const data = rowData(row, options.statusByClient);
    return [data.unit, data.client, data.installments, data.type, data.amount, data.comment];
  });
  const worksheet = xlsx.utils.aoa_to_sheet([
    ["Unidad", "Cliente", "Cuotas", "Tipo", "Monto", "Coment."],
    ...dataRows
  ]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Cobro en ruta");
  const bytes = xlsx.write(workbook, { type: "array", bookType: "xlsx" });
  const url = URL.createObjectURL(new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `lista-cobro-en-ruta-${options.now.toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function truncate(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const value = text.replace(/\s+/g, " ").trim() || "-";
  if (context.measureText(value).width <= maxWidth) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${value.slice(0, middle)}...`).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low)}...`;
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  align: CanvasTextAlign = "left"
): void {
  const width = Math.max(12, maxWidth);
  context.textAlign = align;
  context.fillText(truncate(context, text, width), align === "right" ? x + width : x, y);
  context.textAlign = "left";
}

function exportImage(options: Options, rows: ReceivableRow[]): void {
  const canvas = document.createElement("canvas");
  const width = 1600;
  const left = 30;
  const right = width - 30;
  const top = 34;
  const headerHeight = 64;
  const rowHeight = Math.max(54, Math.min(68, Math.floor(1100 / Math.max(1, rows.length))));
  const rowFont = Math.max(17, Math.min(24, Math.floor(rowHeight * 0.42)));
  const tableWidth = right - left;
  const tableBottom = top + headerHeight + rows.length * rowHeight;
  canvas.width = width;
  canvas.height = Math.max(700, tableBottom + 160);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");
  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, canvas.width, canvas.height);
  roundedRect(context, left, top, tableWidth, headerHeight + rows.length * rowHeight, 8);
  context.fillStyle = "#ffffff";
  context.fill();
  context.strokeStyle = "#dbe1ea";
  context.stroke();
  const gradient = context.createLinearGradient(left, top, right, top + headerHeight);
  gradient.addColorStop(0, "#0f766e");
  gradient.addColorStop(1, "#0b5e58");
  roundedRect(context, left, top, tableWidth, headerHeight, 8);
  context.fillStyle = gradient;
  context.fill();
  const columns = { unit: left + 28, client: left + 155, installments: left + 700, type: left + 995, amount: left + 1170, comment: left + 1320 };
  context.fillStyle = "#ffffff";
  context.font = "bold 24px Segoe UI, Arial, sans-serif";
  ["Unidad", "Cliente", "Cuotas", "Tipo", "Monto", "Coment."].forEach((label, index) => {
    context.fillText(label, Object.values(columns)[index], top + 41);
  });

  rows.forEach((row, index) => {
    const data = rowData(row, options.statusByClient);
    const y = top + headerHeight + index * rowHeight;
    const baseline = y + Math.floor(rowHeight * 0.66);
    context.fillStyle = index % 2 === 0 ? "#fcfdff" : "#f7f9fc";
    context.fillRect(left, y, tableWidth, rowHeight);
    context.strokeStyle = "#e7edf5";
    context.beginPath();
    context.moveTo(left, y + rowHeight);
    context.lineTo(right, y + rowHeight);
    context.stroke();
    context.font = `bold ${rowFont}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#0b5e58";
    context.fillText(data.unit, columns.unit, baseline);
    context.font = `${rowFont}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#1e293b";
    drawText(context, data.client, columns.client, baseline, columns.installments - columns.client - 18);
    drawText(context, data.installments, columns.installments, baseline, columns.type - columns.installments - 18);
    drawText(context, data.type, columns.type, baseline, columns.amount - columns.type - 18);
    context.font = `bold ${rowFont}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#0b5e58";
    drawText(context, formatCurrency(data.amount), columns.amount, baseline, columns.comment - columns.amount - 18, "right");
    context.font = `${Math.max(15, rowFont - 1)}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#334155";
    drawText(context, data.comment, columns.comment, baseline, right - columns.comment - 18);
  });

  const total = rows.reduce((sum, row) => sum + (options.statusByClient[row.id]?.managementAmount ?? 0), 0);
  const solo = rows.filter((row) => options.statusByClient[row.id]?.managementType === "solo_cobrar").length;
  context.fillStyle = "#7c8ea6";
  context.font = "22px Segoe UI, Arial, sans-serif";
  context.fillText(
    `Unidades enviadas: ${rows.length} | Solo cobrar: ${solo} | Cobrar/quitar: ${rows.length - solo} | Esperado recolectar: ${formatCurrency(total)}`,
    left,
    tableBottom + 46
  );
  context.fillText(`(Reporte generado el ${options.now.toLocaleString("es-PA")})`, left, tableBottom + 74);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `lista-cobro-en-ruta-${options.now.toISOString().slice(0, 10)}.png`;
  link.click();
}

export async function exportRouteCollection(options: Options): Promise<boolean> {
  const rows = routeRows(options);
  if (rows.length === 0) return false;
  if (options.format === "pdf") await exportPdf(options, rows);
  else if (options.format === "excel") await exportExcel(options, rows);
  else exportImage(options, rows);
  return true;
}
