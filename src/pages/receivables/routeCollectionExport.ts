import { formatCurrency } from "../../format";
import type { ReceivableRow } from "../../receivables";
import { fieldManagementLabel, type CollectionStatusRecord, type RouteExportFormat } from "./receivablesTypes";

type Options = {
  rows: ReceivableRow[];
  statusByClient: Record<string, CollectionStatusRecord>;
  format: RouteExportFormat;
  now: Date;
};

type RouteTypePalette = {
  rowFill: [number, number, number];
  typeFill: [number, number, number];
  text: [number, number, number];
  border: [number, number, number];
  excelRowFill: string;
  excelTypeFill: string;
  excelText: string;
  excelBorder: string;
};

type RouteAssignmentPalette = {
  fill: [number, number, number];
  text: [number, number, number];
  border: [number, number, number];
  excelFill: string;
  excelText: string;
  excelBorder: string;
};

const ROUTE_TYPE_PALETTE: Record<NonNullable<CollectionStatusRecord["managementType"]>, RouteTypePalette> = {
  solo_cobrar: {
    rowFill: [240, 253, 250],
    typeFill: [204, 251, 241],
    text: [15, 118, 110],
    border: [94, 234, 212],
    excelRowFill: "FFF0FDFA",
    excelTypeFill: "FFCCFBF1",
    excelText: "FF0F766E",
    excelBorder: "FF5EEAD4"
  },
  cobrar_o_quitar: {
    rowFill: [255, 247, 237],
    typeFill: [254, 215, 170],
    text: [154, 52, 18],
    border: [251, 146, 60],
    excelRowFill: "FFFFF7ED",
    excelTypeFill: "FFFED7AA",
    excelText: "FF9A3412",
    excelBorder: "FFFB923C"
  },
  desiste: {
    rowFill: [250, 245, 255],
    typeFill: [233, 213, 255],
    text: [107, 33, 168],
    border: [192, 132, 252],
    excelRowFill: "FFFAF5FF",
    excelTypeFill: "FFE9D5FF",
    excelText: "FF6B21A8",
    excelBorder: "FFC084FC"
  },
  quitar: {
    rowFill: [254, 242, 242],
    typeFill: [254, 202, 202],
    text: [185, 28, 28],
    border: [248, 113, 113],
    excelRowFill: "FFFEF2F2",
    excelTypeFill: "FFFECACA",
    excelText: "FFB91C1C",
    excelBorder: "FFF87171"
  }
};

const ROUTE_ASSIGNMENT_PALETTE: Record<string, RouteAssignmentPalette> = {
  PTY: {
    fill: [219, 234, 254],
    text: [30, 64, 175],
    border: [147, 197, 253],
    excelFill: "FFDBEAFE",
    excelText: "FF1E40AF",
    excelBorder: "FF93C5FD"
  },
  WC: {
    fill: [220, 252, 231],
    text: [22, 101, 52],
    border: [134, 239, 172],
    excelFill: "FFDCFCE7",
    excelText: "FF166534",
    excelBorder: "FF86EFAC"
  }
};

function routeTypePalette(type: CollectionStatusRecord["managementType"]): RouteTypePalette {
  return type ? ROUTE_TYPE_PALETTE[type] : ROUTE_TYPE_PALETTE.solo_cobrar;
}

function routeAssignmentPalette(route: string): RouteAssignmentPalette | undefined {
  return ROUTE_ASSIGNMENT_PALETTE[route.trim().toUpperCase()];
}

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
    .sort((left, right) => {
      return left.unitId.localeCompare(right.unitId);
    });
}

function rowData(row: ReceivableRow, statusByClient: Record<string, CollectionStatusRecord>) {
  const management = statusByClient[row.id];
  return {
    unit: row.unitId,
    client: row.name,
    installments: `${formatCurrency(row.overdueBalance)} (${lateInstallmentsLabel(row.overdueBalance, row.rentAmount)})`,
    route: management?.routeAssignment ?? "-",
    type: fieldManagementLabel(management?.managementType),
    amount: management?.managementAmount ?? 0,
    comment: (management?.managementComment ?? "").trim().slice(0, 25) || "-",
    managementType: management?.managementType
  };
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

function imageInstallmentsParts(row: ReceivableRow): { amount: string; count: string } {
  return {
    amount: formatCurrency(row.overdueBalance),
    count: `(${lateInstallmentsLabel(row.overdueBalance, row.rentAmount)})`
  };
}

async function exportPdf(options: Options, rows: ReceivableRow[]): Promise<void> {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);
  const doc = new JsPDF({ orientation: "landscape", format: "a4" });
  autoTable(doc, {
    head: [["Unidad", "Cliente", "Ruta", "Cuotas", "Tipo", "Monto", "Coment."]],
    body: rows.map((row) => {
      const data = rowData(row, options.statusByClient);
      return [data.unit, data.client, data.route, data.installments, data.type, formatCurrency(data.amount), data.comment];
    }),
    startY: 14,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: "bold" },
    didParseCell: (hookData: any) => {
      if (hookData.section !== "body") return;
      const sourceRow = rows[hookData.row.index];
      if (!sourceRow) return;
      const data = rowData(sourceRow, options.statusByClient);
      const palette = routeTypePalette(data.managementType);
      const assignmentPalette = routeAssignmentPalette(data.route);
      hookData.cell.styles.fillColor = palette.rowFill;
      if (hookData.column.index === 2 && assignmentPalette) {
        hookData.cell.styles.fillColor = assignmentPalette.fill;
        hookData.cell.styles.textColor = assignmentPalette.text;
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.lineColor = assignmentPalette.border;
        hookData.cell.styles.lineWidth = 0.2;
      }
      if (hookData.column.index === 4) {
        hookData.cell.styles.fillColor = palette.typeFill;
        hookData.cell.styles.textColor = palette.text;
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.lineColor = palette.border;
        hookData.cell.styles.lineWidth = 0.2;
      }
    }
  });
  doc.save(`lista-cobro-en-ruta-${options.now.toISOString().slice(0, 10)}.pdf`);
}

async function exportExcel(options: Options, rows: ReceivableRow[]): Promise<void> {
  const exceljs = await import("exceljs");
  const workbook = new exceljs.Workbook();
  const worksheet = workbook.addWorksheet("Cobro en ruta");
  const headers = ["Unidad", "Cliente", "Ruta", "Cuotas", "Tipo", "Monto", "Coment."];
  worksheet.addRow(headers);
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  });
  for (const row of rows) {
    const data = rowData(row, options.statusByClient);
    const excelRow = worksheet.addRow([data.unit, data.client, data.route, data.installments, data.type, data.amount, data.comment]);
    const palette = routeTypePalette(data.managementType);
    const assignmentPalette = routeAssignmentPalette(data.route);
    excelRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.excelRowFill } };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } }
      };
    });
    if (assignmentPalette) {
      const routeCell = excelRow.getCell(3);
      routeCell.font = { bold: true, color: { argb: assignmentPalette.excelText } };
      routeCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: assignmentPalette.excelFill } };
      routeCell.border = {
        top: { style: "thin", color: { argb: assignmentPalette.excelBorder } },
        left: { style: "thin", color: { argb: assignmentPalette.excelBorder } },
        bottom: { style: "thin", color: { argb: assignmentPalette.excelBorder } },
        right: { style: "thin", color: { argb: assignmentPalette.excelBorder } }
      };
    }
    const typeCell = excelRow.getCell(5);
    typeCell.font = { bold: true, color: { argb: palette.excelText } };
    typeCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.excelTypeFill } };
    typeCell.border = {
      top: { style: "thin", color: { argb: palette.excelBorder } },
      left: { style: "thin", color: { argb: palette.excelBorder } },
      bottom: { style: "thin", color: { argb: palette.excelBorder } },
      right: { style: "thin", color: { argb: palette.excelBorder } }
    };
  }
  headers.forEach((header, index) => {
    const maxLength = Math.max(header.length, ...rows.map((row) => {
      const data = rowData(row, options.statusByClient);
      return String([data.unit, data.client, data.route, data.installments, data.type, data.amount, data.comment][index] ?? "").length;
    }));
    worksheet.getColumn(index + 1).width = Math.min(42, Math.max(10, maxLength + 2));
  });
  worksheet.getColumn(6).numFmt = "$#,##0.00";
  const bytes = await workbook.xlsx.writeBuffer();
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
  const top = 104;
  const headerHeight = 58;
  const rowHeight = Math.max(62, Math.min(74, Math.floor(1120 / Math.max(1, rows.length))));
  const rowFont = Math.max(17, Math.min(24, Math.floor(rowHeight * 0.42)));
  const tableWidth = right - left;
  const tableBottom = top + headerHeight + rows.length * rowHeight;
  canvas.width = width;
  canvas.height = Math.max(430, tableBottom + 118);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");
  context.fillStyle = "#f5f7fb";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const total = rows.reduce((sum, row) => sum + (options.statusByClient[row.id]?.managementAmount ?? 0), 0);
  const solo = rows.filter((row) => options.statusByClient[row.id]?.managementType === "solo_cobrar").length;
  const cobrarOQuitar = rows.filter((row) => options.statusByClient[row.id]?.managementType === "cobrar_o_quitar").length;
  const desiste = rows.filter((row) => options.statusByClient[row.id]?.managementType === "desiste").length;
  const quitar = rows.filter((row) => options.statusByClient[row.id]?.managementType === "quitar").length;

  context.fillStyle = "#0f172a";
  context.font = "bold 32px Segoe UI, Arial, sans-serif";
  context.fillText("Cobro en Ruta", left, 48);
  context.fillStyle = "#64748b";
  context.font = "20px Segoe UI, Arial, sans-serif";
  context.fillText(`Generado el ${options.now.toLocaleString("es-PA")}`, left, 78);

  const summaryText = `${rows.length} unidades  /  ${formatCurrency(total)} esperado`;
  context.font = "bold 20px Segoe UI, Arial, sans-serif";
  const summaryWidth = context.measureText(summaryText).width + 34;
  roundedRect(context, right - summaryWidth, 30, summaryWidth, 42, 12);
  context.fillStyle = "#e6f6f3";
  context.fill();
  context.strokeStyle = "#b8e4dc";
  context.stroke();
  context.fillStyle = "#0f766e";
  context.fillText(summaryText, right - summaryWidth + 17, 57);

  context.save();
  context.shadowColor = "rgba(15, 23, 42, 0.13)";
  context.shadowBlur = 22;
  context.shadowOffsetY = 10;
  roundedRect(context, left, top, tableWidth, headerHeight + rows.length * rowHeight, 14);
  context.fillStyle = "#ffffff";
  context.fill();
  context.restore();
  roundedRect(context, left, top, tableWidth, headerHeight + rows.length * rowHeight, 14);
  context.strokeStyle = "#dbe1ea";
  context.stroke();
  const gradient = context.createLinearGradient(left, top, right, top + headerHeight);
  gradient.addColorStop(0, "#0f766e");
  gradient.addColorStop(0.55, "#0d6f67");
  gradient.addColorStop(1, "#0a5752");
  roundedRect(context, left, top, tableWidth, headerHeight, 14);
  context.fillStyle = gradient;
  context.fill();
  const columns = { unit: left + 28, client: left + 155, installments: left + 430, type: left + 690, amount: left + 940, comment: left + 1085, route: left + 1445 };
  context.fillStyle = "#ffffff";
  context.font = "bold 22px Segoe UI, Arial, sans-serif";
  ["Unidad", "Cliente", "Cuotas", "Tipo", "Monto", "Coment.", "Ruta"].forEach((label, index) => {
    context.fillText(label, Object.values(columns)[index], top + 37);
  });

  rows.forEach((row, index) => {
    const data = rowData(row, options.statusByClient);
    const installmentsParts = imageInstallmentsParts(row);
    const palette = routeTypePalette(data.managementType);
    const y = top + headerHeight + index * rowHeight;
    const baseline = y + Math.floor(rowHeight * 0.66);
    const secondaryBaseline = baseline + Math.max(15, Math.floor(rowFont * 0.8));
    context.fillStyle = index % 2 === 0 ? "#ffffff" : "#fbfcfe";
    context.fillRect(left, y, tableWidth, rowHeight);
    context.strokeStyle = "#edf2f7";
    context.beginPath();
    context.moveTo(left, y + rowHeight);
    context.lineTo(right, y + rowHeight);
    context.stroke();

    context.strokeStyle = "#f1f5f9";
    [columns.client - 18, columns.installments - 22, columns.type - 20, columns.amount - 26, columns.comment - 20, columns.route - 18].forEach((x) => {
      context.beginPath();
      context.moveTo(x, y + 12);
      context.lineTo(x, y + rowHeight - 12);
      context.stroke();
    });

    context.font = `bold ${rowFont}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#0b5e58";
    context.fillText(data.unit, columns.unit, baseline);
    context.font = `${rowFont}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#1e293b";
    drawText(context, firstName(data.client), columns.client, baseline, columns.installments - columns.client - 18);
    context.font = `bold ${rowFont}px Segoe UI, Arial, sans-serif`;
    drawText(context, installmentsParts.amount, columns.installments, baseline - 9, columns.type - columns.installments - 18);
    context.font = `${Math.max(14, rowFont - 3)}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#64748b";
    drawText(context, installmentsParts.count, columns.installments, secondaryBaseline - 10, columns.type - columns.installments - 18);
    const typeX = columns.type - 8;
    const typeY = y + Math.max(8, Math.floor((rowHeight - 34) / 2));
    const typeWidth = columns.amount - columns.type - 30;
    const typeHeight = 34;
    roundedRect(context, typeX, typeY, typeWidth, typeHeight, 8);
    context.fillStyle = `rgb(${palette.typeFill.join(",")})`;
    context.fill();
    context.strokeStyle = `rgb(${palette.border.join(",")})`;
    context.stroke();
    context.fillStyle = `rgb(${palette.text.join(",")})`;
    context.font = `bold ${Math.max(15, rowFont - 1)}px Segoe UI, Arial, sans-serif`;
    drawText(context, data.type, columns.type, baseline, columns.amount - columns.type - 36);
    context.font = `bold ${rowFont}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#0b5e58";
    drawText(context, formatCurrency(data.amount), columns.amount, baseline, columns.comment - columns.amount - 18, "right");
    context.font = `${Math.max(15, rowFont - 1)}px Segoe UI, Arial, sans-serif`;
    context.fillStyle = "#334155";
    drawText(context, data.comment, columns.comment, baseline, columns.route - columns.comment - 18);
    context.font = `bold ${Math.max(15, rowFont - 1)}px Segoe UI, Arial, sans-serif`;
    const assignmentPalette = routeAssignmentPalette(data.route);
    if (assignmentPalette) {
      const routeX = columns.route - 8;
      const routeY = y + Math.max(8, Math.floor((rowHeight - 34) / 2));
      const routeWidth = right - columns.route - 2;
      roundedRect(context, routeX, routeY, routeWidth, 34, 8);
      context.fillStyle = `rgb(${assignmentPalette.fill.join(",")})`;
      context.fill();
      context.strokeStyle = `rgb(${assignmentPalette.border.join(",")})`;
      context.stroke();
      context.fillStyle = `rgb(${assignmentPalette.text.join(",")})`;
    } else {
      context.fillStyle = "#334155";
    }
    drawText(context, data.route, columns.route, baseline, right - columns.route - 6);
  });

  const footerY = tableBottom + 28;
  const footerItems = [
    `Unidades: ${rows.length}`,
    `Solo cobrar: ${solo}`,
    `Cobrar/quitar: ${cobrarOQuitar}`,
    `Desiste: ${desiste}`,
    `Quitar: ${quitar}`,
    `Esperado: ${formatCurrency(total)}`
  ];
  let footerX = left;
  context.font = "bold 20px Segoe UI, Arial, sans-serif";
  footerItems.forEach((item) => {
    const chipWidth = context.measureText(item).width + 28;
    roundedRect(context, footerX, footerY, chipWidth, 40, 12);
    context.fillStyle = "#ffffff";
    context.fill();
    context.strokeStyle = "#dbe8f1";
    context.stroke();
    context.fillStyle = "#59708e";
    context.fillText(item, footerX + 14, footerY + 27);
    footerX += chipWidth + 12;
  });
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
