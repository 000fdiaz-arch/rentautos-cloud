import { formatFileDate } from "./format";

export async function exportClientsToExcel(
  headers: string[],
  body: (string | number)[][],
  now: Date
): Promise<void> {
  const xlsx = await import("xlsx");
  const worksheet = xlsx.utils.aoa_to_sheet([headers, ...body]);

  const colWidths = headers.map((header, index) => ({
    wch: Math.max(header.length, ...body.map((row) => String(row[index]).length)) + 2
  }));
  worksheet["!cols"] = colWidths;

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Clientes");
  xlsx.writeFile(workbook, `cobrapp-clientes-${formatFileDate(now)}.xlsx`);
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
  document.setFontSize(14);
  document.text("Cobrapp - Modulo 1", 14, 16);
  document.setFontSize(9);
  document.text(`Generado: ${now.toLocaleDateString("es-PA")}`, 14, 22);

  autoTable(document, {
    head: [headers],
    body: body.map((row) => row.map(String)),
    startY: 28,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] }
  });

  document.save(`cobrapp-clientes-${formatFileDate(now)}.pdf`);
}
