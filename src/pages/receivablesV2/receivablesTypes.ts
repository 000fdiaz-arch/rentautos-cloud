export type PromiseFollowupInput = { editPromise?: boolean; promiseAt: string; nextDate?: string; nextTime?: string; amount?: number; note?: string; sendToRoute?: boolean; paymentReviewKey?: string };
export type ContactOutcomeResult = "no_answer" | "promise" | "reported_paid" | "escalated" | "closed_today" | "paid_up" | "reminder_today" | "reminder_tomorrow";
export type PaymentPromiseDraft = { date: string; time: string; amount: number };
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
export type DailyContactShift = "morning" | "afternoon" | "night";
export type DailyContactResult = "contacted";
export type DailyContactAttempt = {
  result: DailyContactResult;
  updatedAt: string;
};
export type DailyContactAttempts = Partial<Record<DailyContactShift, DailyContactAttempt>>;
export type DailyContactAttemptsByDate = Record<string, DailyContactAttempts>;
export type DailyContactCloudAttempt = {
  result: DailyContactResult | "pending";
  updatedAt: string;
};
export type DailyContactCloudAttempts = Partial<Record<DailyContactShift, DailyContactCloudAttempt>>;
export type DailyContactSaveState = "saving" | "saved" | "error";
export type DailyContactSaveStates = Partial<Record<DailyContactShift, DailyContactSaveState>>;

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
  contactOutcomes?: Array<{ date: string; at: string; collector: string; result: ContactOutcomeResult; followupOf?: string; nextContactAt?: string; note?: string; sendToRoute?: boolean; promiseDate?: string; promiseTime?: string; promiseAmount?: number; promiseCancelledAt?: string; promisePaymentSince?: string; paymentReviewKey?: string }>;
  paymentPromiseTime?: string;
  paymentPromiseAmount?: number;
  paymentPromiseUpdatedAt?: string;
  gpsLocationNote?: string;
  gpsLocationReviewedAt?: string;
  operationalReviewStatus?: string;
  operationalReviewedAt?: string;
  dailyContactAttemptsByDate?: DailyContactAttemptsByDate;
  priorityDebtCap?: number;
  priorityDebtCapUpdatedAt?: string;
};
