export function normalizeCourtName(value: string): string {
  const normalized = value.trim().toLocaleUpperCase("es-PA");
  return normalized === "JAUN DIAZ" ? "JUAN DIAZ" : normalized;
}
