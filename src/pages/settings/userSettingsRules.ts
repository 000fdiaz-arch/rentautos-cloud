const INTERNAL_AUTH_DOMAIN_PATTERN = /@(auth\.rentautos\.(?:local|app))$/i;

export function formatUserLogin(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  return normalized.replace(INTERNAL_AUTH_DOMAIN_PATTERN, "");
}
