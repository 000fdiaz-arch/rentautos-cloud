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
