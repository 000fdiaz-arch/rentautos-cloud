export type IncidentDocumentationAvailability = "" | "yes" | "no";

export function requiresInsuranceFud(documentationAvailable: IncidentDocumentationAvailability): boolean {
  return documentationAvailable === "yes";
}

export function requiresInsuranceClaimDetails(documentationAvailable: IncidentDocumentationAvailability): boolean {
  return documentationAvailable === "yes";
}

export function insuranceClaimStatusAfterFudCompletion(
  currentStatus: "Inactivo" | "Activo" | "Finalizado",
  claimNumber: string
): "Inactivo" | "Activo" | "Finalizado" {
  if (currentStatus === "Finalizado") return "Finalizado";
  return claimNumber.trim() ? "Activo" : "Inactivo";
}

export function shouldUploadInsuranceFud(
  documentationAvailable: IncidentDocumentationAvailability,
  hasFudFile: boolean
): boolean {
  return requiresInsuranceFud(documentationAvailable) && hasFudFile;
}
