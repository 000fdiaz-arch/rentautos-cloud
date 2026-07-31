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
export type FieldManagementType = "solo_cobrar" | "cobrar_o_quitar";
export type RouteExportFormat = "jpg" | "pdf" | "excel";
export type WhatsAppContactFilter = "all" | "pending" | "ready" | "sent" | "idle";
export type RouteAssignment = "PTY" | "WC" | "CL" | (string & {});

export type CollectionStatusRecord = {
  status: CollectionStatus;
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
