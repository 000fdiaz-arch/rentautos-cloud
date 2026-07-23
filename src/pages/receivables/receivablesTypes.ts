export type CollectionStatus = "no_answer" | "reminder" | "call_later" | "paid";
export type FieldManagementType = "solo_cobrar" | "cobrar_o_quitar";
export type RouteExportFormat = "jpg" | "pdf" | "excel";

export type CollectionStatusRecord = {
  status: CollectionStatus;
  comment: string;
  updatedAt: string;
  managementType?: FieldManagementType;
  managementAmount?: number;
  managementComment?: string;
  managementUpdatedAt?: string;
  whatsAppMessageCopiedAt?: string;
  whatsAppMessageSentAt?: string;
  whatsAppMessageText?: string;
};
