import { formatFileDate } from "./format";

function normalizeStatusText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function resolveStatusPalette(statusRaw: string): { fill: string; text: string; border?: string } {
  const status = normalizeStatusText(statusRaw);

  if (status.includes("PAGADO") || status.includes("AL DIA")) {
    return { fill: "FFD1FAE5", text: "FF166534", border: "FF86EFAC" };
  }
  if (status.includes("MOROSO CRITICO")) {
    return { fill: "FFFEE2E2", text: "FF991B1B", border: "FFF87171" };
  }
  if (status.includes("VENCIDO") || status.includes("MORA")) {
    return { fill: "FFFEE2E2", text: "FFB91C1C", border: "FFF87171" };
  }
  if (status.includes("PENDIENTE")) {
    return { fill: "FFFEF9C3", text: "FF854D0E", border: "FFFDE047" };
  }
  return { fill: "FFF1F5F9", text: "FF334155" };
}

function hexToRgbTuple(argb: string): [number, number, number] {
  return [
    parseInt(argb.slice(2, 4), 16),
    parseInt(argb.slice(4, 6), 16),
    parseInt(argb.slice(6, 8), 16)
  ];
}

function buildStatusCellStyler(headers: string[]) {
  const statusIndex = headers.findIndex((header) => header.trim().toUpperCase() === "ESTADO");

  return (data: any) => {
    if (statusIndex === -1 || data.section !== "body" || data.column.index !== statusIndex) {
      return;
    }

    const palette = resolveStatusPalette(String(data.cell.raw ?? data.cell.text ?? ""));
    data.cell.styles.fillColor = hexToRgbTuple(palette.fill);
    data.cell.styles.textColor = hexToRgbTuple(palette.text);
    if (palette.border) {
      data.cell.styles.lineColor = hexToRgbTuple(palette.border);
      data.cell.styles.lineWidth = 0.2;
    }
  };
}

async function exportToExcelWithStatusColors(
  sheetName: string,
  fileName: string,
  headers: string[],
  body: (string | number)[][],
  options?: {
    dropdownColumns?: Array<{ header: string; values: string[] }>;
  }
): Promise<void> {
  const exceljs = await import("exceljs");
  const workbook = new exceljs.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.addRow(headers);
  for (const row of body) {
    worksheet.addRow(row);
  }

  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  });

  headers.forEach((header, index) => {
    const maxBodyLength = Math.max(...body.map((row) => String(row[index] ?? "").length), 0);
    worksheet.getColumn(index + 1).width = Math.max(header.length, maxBodyLength) + 2;
  });

  const statusIndex = headers.findIndex((header) => header.trim().toUpperCase() === "ESTADO");
  if (statusIndex !== -1) {
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const cell = worksheet.getCell(rowNumber, statusIndex + 1);
      const palette = resolveStatusPalette(String(cell.value ?? ""));
      cell.font = { bold: true, color: { argb: palette.text } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.fill } };
      if (palette.border) {
        cell.border = {
          top: { style: "thin", color: { argb: palette.border } },
          left: { style: "thin", color: { argb: palette.border } },
          bottom: { style: "thin", color: { argb: palette.border } },
          right: { style: "thin", color: { argb: palette.border } }
        };
      }
    }
  }

  for (const dropdownColumn of options?.dropdownColumns ?? []) {
    const columnIndex = headers.findIndex(
      (header) => header.trim().toUpperCase() === dropdownColumn.header.trim().toUpperCase()
    );
    if (columnIndex === -1 || dropdownColumn.values.length === 0) continue;
    const formulaValues = dropdownColumn.values.map((value) => value.replace(/"/g, '""')).join(",");
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      worksheet.getCell(rowNumber, columnIndex + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${formulaValues}"`],
        showErrorMessage: true,
        errorTitle: "Valor invalido",
        error: "Selecciona una opcion de la lista."
      };
    }
  }

  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportClientsToExcel(
  headers: string[],
  body: (string | number)[][],
  now: Date
): Promise<void> {
  await exportToExcelWithStatusColors(
    "Clientes",
    `rentautos-clientes-${formatFileDate(now)}.xlsx`,
    headers,
    body
  );
}

export async function exportClientsToPdf(
  headers: string[],
  body: (string | number)[][],
  now: Date
): Promise<void> {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);

  const document = new JsPDF({ orientation: "landscape" });
  const rows = body.map((row) => row.map(String));
  const rowsPerPage = 50;
  const pages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

  for (let page = 0; page < pages; page += 1) {
    if (page > 0) {
      document.addPage();
    }

    document.setFontSize(14);
    document.text("Rentautos - Clientes", 14, 16);
    document.setFontSize(9);
    document.text(`Generado: ${now.toLocaleDateString("es-PA")}`, 14, 22);

    autoTable(document, {
      head: [headers],
      body: rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage),
      startY: 28,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: buildStatusCellStyler(headers)
    });
  }

  document.save(`rentautos-clientes-${formatFileDate(now)}.pdf`);
}

export async function exportReceivablesToExcel(
  headers: string[],
  body: (string | number)[][],
  now: Date
): Promise<void> {
  await exportToExcelWithStatusColors(
    "Cuentas por Cobrar",
    `rentautos-cuentas-por-cobrar-${formatFileDate(now)}.xlsx`,
    headers,
    body,
    {
      dropdownColumns: [
        {
          header: "ESTADO COBRANZA",
          values: [
            "Llamada no responde, se dejo mensaje.",
            "Mensaje recordatorio.",
            "Llamar mas tarde.",
            "Pago confirmado."
          ]
        },
        {
          header: "COBRO EN RUTA",
          values: ["SI", "NO"]
        }
      ]
    }
  );
}

export async function exportReceivablesToPdf(
  headers: string[],
  body: (string | number)[][],
  now: Date
): Promise<void> {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);

  const document = new JsPDF({ orientation: "portrait", format: "a4" });
  const rows = body.map((row) => row.map(String));
  const rowsPerPage = 50;
  const pages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

  for (let page = 0; page < pages; page += 1) {
    if (page > 0) {
      document.addPage("a4", "portrait");
    }

    document.setFontSize(12);
    document.text("Rentautos - Cuentas por Cobrar", 14, 14);
    document.setFontSize(8);
    document.text(`Generado: ${now.toLocaleDateString("es-PA")} | Pagina ${page + 1} de ${pages}`, 14, 19);

    autoTable(document, {
      head: [headers],
      body: rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage),
      startY: 22,
      margin: { top: 22, bottom: 8, left: 8, right: 8 },
      styles: {
        fontSize: 6.5,
        cellPadding: 1,
        overflow: "ellipsize",
        lineWidth: 0.1
      },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: "bold", fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: buildStatusCellStyler(headers)
    });
  }

  document.save(`rentautos-cuentas-por-cobrar-${formatFileDate(now)}.pdf`);
}

export async function exportAmClosureToPdf(
  blockLabel: "AM" | "PM" | "CIERRE",
  summary: {
    date: string;
    time: string;
    totalUnits: number;
    noResponse: number;
    reminder: number;
    callLater: number;
    paidClientsAtClose: number;
    paymentEntriesAtClose: number;
    promiseActive: number;
    promiseDueOrNear: number;
    promisePartialBreach: number;
  },
  detailRows: Array<{
    unitId: string;
    client: string;
    amStatus: string;
    comment: string;
    inheritToPm: string;
    promiseNote?: string;
  }>
): Promise<void> {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);
  const document = new JsPDF({ orientation: "landscape" });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const accent: [number, number, number] = [15, 118, 110];
  const effectiveTotal = Math.max(1, summary.totalUnits);
  const pctNoResponse = Math.round((summary.noResponse / effectiveTotal) * 100);
  const pctReminder = Math.round((summary.reminder / effectiveTotal) * 100);
  const pctCallLater = Math.round((summary.callLater / effectiveTotal) * 100);

  // Fondo y cabecera premium
  document.setFillColor(247, 250, 255);
  document.rect(0, 0, pageWidth, pageHeight, "F");
  document.setFillColor(233, 246, 255);
  document.rect(0, 0, pageWidth, 36, "F");
  document.setDrawColor(180, 228, 241);
  document.line(0, 36, pageWidth, 36);
  document.setDrawColor(...accent);
  document.setLineWidth(0.6);
  document.line(12, 30, pageWidth - 12, 30);
  document.setFontSize(16);
  document.setTextColor(20, 35, 60);
  document.text(`Rentautos · Reporte Dinámico de Gestión ${blockLabel}`, 14, 17);
  document.setFontSize(9);
  document.setTextColor(55, 79, 112);
  document.text(`Fecha: ${summary.date}  |  Hora: ${summary.time}`, 14, 24);

  const managementKpis = [
    { label: "Base AM", value: String(summary.totalUnits), bg: [255, 247, 217] as [number, number, number], border: [245, 158, 11] as [number, number, number] },
    { label: "No responde", value: String(summary.noResponse), bg: [254, 234, 234] as [number, number, number], border: [239, 68, 68] as [number, number, number] },
    { label: "Recordatorio", value: String(summary.reminder), bg: [243, 236, 255] as [number, number, number], border: [168, 85, 247] as [number, number, number] },
    { label: "Llamar más tarde", value: String(summary.callLater), bg: [226, 248, 245] as [number, number, number], border: [20, 184, 166] as [number, number, number] },
    { label: "Promesas activas", value: String(summary.promiseActive), bg: [233, 244, 255] as [number, number, number], border: [59, 130, 246] as [number, number, number] },
    { label: "Promesa próx./vencida", value: String(summary.promiseDueOrNear), bg: [255, 247, 217] as [number, number, number], border: [245, 158, 11] as [number, number, number] },
    { label: "Incumplida parcial", value: String(summary.promisePartialBreach), bg: [254, 234, 234] as [number, number, number], border: [220, 38, 38] as [number, number, number] }
  ];
  const paymentKpis = [
    { label: "Clientes que pagaron", value: String(summary.paidClientsAtClose), bg: [220, 252, 231] as [number, number, number], border: [34, 197, 94] as [number, number, number] },
    { label: "Pagos procesados", value: String(summary.paymentEntriesAtClose), bg: [236, 253, 245] as [number, number, number], border: [16, 185, 129] as [number, number, number] }
  ];
  const cardW = 35;
  const cardH = 20;
  const cardGapX = 2;
  const drawKpiRow = (title: string, kpis: typeof managementKpis, y: number) => {
    document.setFontSize(8.4);
    document.setTextColor(46, 63, 86);
    document.text(title, 14, y - 1.5);
    kpis.forEach((kpi, i) => {
      const x = 14 + i * (cardW + cardGapX);
      document.setFillColor(...kpi.bg);
      document.setDrawColor(...kpi.border);
      document.roundedRect(x, y, cardW, cardH, 2.2, 2.2, "FD");
      document.setFontSize(7.8);
      document.setTextColor(52, 73, 94);
      document.text(kpi.label, x + 3, y + 7);
      document.setFontSize(12.5);
      document.setTextColor(15, 23, 42);
      document.text(kpi.value, x + 3, y + 16);
    });
  };
  drawKpiRow(`Gestión ${blockLabel}`, managementKpis, 39);
  drawKpiRow(`Pagos al cierre ${blockLabel}`, paymentKpis, 64);

  // Bloque visual porcentual en pastel
  const chartX = 14;
  const chartY = 90;
  const chartW = 122;
  const chartH = 46;
  document.setFillColor(252, 254, 255);
  document.setDrawColor(191, 219, 254);
  document.roundedRect(chartX, chartY, chartW, chartH, 2.8, 2.8, "FD");
  document.setFontSize(8.7);
  document.setTextColor(44, 65, 92);
  document.text(`Distribución porcentual ${blockLabel}`, chartX + 4, chartY + 6);

  const cx = chartX + 23;
  const cy = chartY + 24;
  const r = 12;
  const slices = [
    { label: "No responde", value: summary.noResponse, color: [239, 68, 68] as [number, number, number], pct: pctNoResponse },
    { label: "Recordatorio", value: summary.reminder, color: [168, 85, 247] as [number, number, number], pct: pctReminder },
    { label: "Llamar más tarde", value: summary.callLater, color: [20, 184, 166] as [number, number, number], pct: pctCallLater }
  ];
  let angleStart = -90;
  slices.forEach((slice) => {
    const sweep = Math.max(0, (slice.value / effectiveTotal) * 360);
    if (sweep <= 0) return;
    const angleEnd = angleStart + sweep;
    document.setFillColor(...slice.color);
    const step = 4;
    for (let a = angleStart; a < angleEnd; a += step) {
      const b = Math.min(a + step, angleEnd);
      const x1 = cx + r * Math.cos((a * Math.PI) / 180);
      const y1 = cy + r * Math.sin((a * Math.PI) / 180);
      const x2 = cx + r * Math.cos((b * Math.PI) / 180);
      const y2 = cy + r * Math.sin((b * Math.PI) / 180);
      document.triangle(cx, cy, x1, y1, x2, y2, "F");
    }
    angleStart = angleEnd;
  });
  // círculo interior para efecto donut premium
  document.setFillColor(252, 254, 255);
  document.circle(cx, cy, 5.5, "F");
  document.setFontSize(7);
  document.setTextColor(46, 63, 86);
  document.text(blockLabel, cx - 3.5, cy + 1.8);

  slices.forEach((slice, idx) => {
    const y = chartY + 13 + idx * 10;
    const x = chartX + 40;
    document.setFillColor(...slice.color);
    document.roundedRect(x, y - 3.2, 4.5, 4.5, 0.8, 0.8, "F");
    document.setFontSize(7.5);
    document.setTextColor(52, 73, 94);
    document.text(slice.label, x + 6.5, y);
    document.setFontSize(8);
    document.setTextColor(15, 23, 42);
    document.text(`${slice.pct}%`, x + 53, y);
  });

  const bodyRows = detailRows.map((row) => [row.unitId, row.client, row.amStatus, row.comment || "-", row.promiseNote || "-", row.inheritToPm]);
  autoTable(document, {
    startY: chartY + chartH + 5,
    head: [["Unidad", "Cliente", `Estado ${blockLabel}`, "Comentario", "Promesa", blockLabel === "AM" ? "Hereda a PM" : blockLabel === "PM" ? "Hereda a Cierre" : "Gestion siguiente"]],
    body: bodyRows,
    styles: { fontSize: 7.4, cellPadding: 2.8, textColor: [31, 41, 55], lineColor: [224, 232, 242], lineWidth: 0.2 },
    headStyles: { fillColor: [24, 63, 106], textColor: 255, fontStyle: "bold", fontSize: 8.1 },
    alternateRowStyles: { fillColor: [248, 252, 255] },
    didParseCell: (data: any) => {
      if (data.section === "body" && data.column.index === 2) {
        const status = String(data.cell.raw ?? "").toLowerCase();
        if (status.includes("no responde")) {
          data.cell.styles.fillColor = [254, 234, 234];
          data.cell.styles.textColor = [153, 27, 27];
        } else if (status.includes("recordatorio")) {
          data.cell.styles.fillColor = [243, 236, 255];
          data.cell.styles.textColor = [91, 33, 182];
        } else if (status.includes("llamar")) {
          data.cell.styles.fillColor = [226, 248, 245];
          data.cell.styles.textColor = [17, 94, 89];
        }
      }
      if (data.section === "body" && data.column.index === 5) {
        const inherits = String(data.cell.raw ?? "").toLowerCase() === "sí";
        data.cell.styles.fillColor = inherits ? [255, 247, 217] : [233, 249, 243];
        data.cell.styles.textColor = inherits ? [146, 64, 14] : [6, 95, 70];
      }
    }
  });

  document.save(`rentautos-gestion-${blockLabel.toLowerCase()}-${summary.date}.pdf`);
}



