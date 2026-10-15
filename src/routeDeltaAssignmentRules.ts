const DELTA1_ONLY_CLIENT_NAMES = new Set([
  "KEYSHA MICHELLE PINO JORDAN",
  "ZACARIAS ARAUZ VIQUEZ"
]);

export function normalizeRouteClientName(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("es");
}

export function isDelta1OnlyRouteClient(value: string | undefined): boolean {
  return DELTA1_ONLY_CLIENT_NAMES.has(normalizeRouteClientName(value));
}
