const MONTH_ABBREVIATIONS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatFileDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = MONTH_ABBREVIATIONS[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

export function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTH_ABBREVIATIONS[date.getMonth()]} ${date.getFullYear()}`;
}
