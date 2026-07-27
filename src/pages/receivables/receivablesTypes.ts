export type CollectionStatus =
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
export type WhatsAppContactFilter = "all" | "pending" | "missing" | "ready" | "opened" | "sent";

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
  whatsAppMessageCopiedAt?: string;
  whatsAppMessageSentAt?: string;
  whatsAppMessageText?: string;
  supportNote?: string;
  supportNoteUpdatedAt?: string;
  paymentPromiseDate?: string;
  paymentPromiseUpdatedAt?: string;
};
