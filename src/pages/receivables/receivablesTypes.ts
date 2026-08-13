export type CollectionStatus =
  | "unassigned"
  | "pending"
  | "contacted"
  | "covered"
  | "route"
  | "no_answer"
  | "reminder"
  | "call_later"
  | "paid"
  | "route_collection"
  | "route_not_sent";
export type FieldManagementType = "solo_cobrar" | "cobrar_o_quitar" | "desiste" | "quitar";
export const FIELD_MANAGEMENT_LABEL: Record<FieldManagementType, string> = {
  solo_cobrar: "Solo cobrar",
  cobrar_o_quitar: "Cobrar o quitar",
  desiste: "Desiste",
  quitar: "Quitar"
};

export function fieldManagementLabel(value: FieldManagementType | undefined): string {
  return value ? FIELD_MANAGEMENT_LABEL[value] : FIELD_MANAGEMENT_LABEL.solo_cobrar;
}
export type RouteExportFormat = "jpg" | "pdf" | "excel";
export type WhatsAppContactFilter = "all" | "pending" | "ready" | "sent" | "idle";
export type RouteAssignment = "PTY" | "WC" | "CL" | (string & {});
export type RouteUrgency = "normal" | "urgent" | "very_urgent";

export type CollectionStatusRecord = {
  status: CollectionStatus;
  isRouteTagged?: boolean;
  routeTaggedAt?: string;
  comment: string;
  updatedAt: string;
  managementType?: FieldManagementType;
  managementAmount?: number;
  managementComment?: string;
  managementUpdatedAt?: string;
  routeReleaseAmount?: number;
  routeReleaseUpdatedAt?: string;
  routeAssignment?: RouteAssignment;
  routeAssignmentUpdatedAt?: string;
  routeUrgency?: RouteUrgency;
  routeUrgencyUpdatedAt?: string;
  whatsAppMessageCopiedAt?: string;
  whatsAppMessageSentAt?: string;
  whatsAppMessageText?: string;
  supportNote?: string;
  supportNoteUpdatedAt?: string;
  contactTime?: string;
  contactTimeUpdatedAt?: string;
  paymentPromiseDate?: string;
  paymentPromiseUpdatedAt?: string;
};
