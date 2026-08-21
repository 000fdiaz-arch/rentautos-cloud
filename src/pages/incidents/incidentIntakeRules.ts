export type IncidentDocumentationAvailability = "" | "yes" | "no";

export function requiresInsuranceFud(documentationAvailable: IncidentDocumentationAvailability): boolean {
  return documentationAvailable === "yes";
}

export function shouldUploadInsuranceFud(
  documentationAvailable: IncidentDocumentationAvailability,
  hasFudFile: boolean
): boolean {
  return requiresInsuranceFud(documentationAvailable) && hasFudFile;
}
