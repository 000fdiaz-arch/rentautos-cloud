import type { CollisionCaseRecord } from "../../cloudData";

export type JudicialCaseTab = "summary" | "attendance" | "follow_up" | "history" | "workshop" | "balance" | "outcome" | "insurance";
export type PendingJudicialStep = "documentation" | "workshop" | "balance" | "attendance" | "outcome" | "management";

function isFinalStatus(status: CollisionCaseRecord["status"]): boolean {
  return status === "ABSUELTO" || status === "CULPABLE";
}

function workshopStepComplete(item: CollisionCaseRecord): boolean {
  return Boolean(item.vehicleInspectedAt || item.expenseInvoice);
}

function calendarDayOffsetFromKeys(value: string, todayDateKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}-\d{2}$/.test(todayDateKey)) return null;
  const target = Date.parse(`${value}T12:00:00Z`);
  const today = Date.parse(`${todayDateKey}T12:00:00Z`);
  if (!Number.isFinite(target) || !Number.isFinite(today)) return null;
  return Math.round((target - today) / 86_400_000);
}

export function nextPendingJudicialStep(item: CollisionCaseRecord, todayDateKey: string): PendingJudicialStep {
  if (item.documentationPending) return "documentation";
  const trialDue = Boolean(item.trialDate && item.trialDate <= todayDateKey);
  if (trialDue) {
    if (!workshopStepComplete(item)) return "workshop";
    if (!item.expenseInvoice) return "balance";
    return "outcome";
  }
  const trialOffset = item.trialDate ? calendarDayOffsetFromKeys(item.trialDate, todayDateKey) : null;
  const attendancePending = typeof item.clientWillAttend !== "boolean" || typeof item.legalAssistanceRequested !== "boolean";
  if (trialOffset !== null && trialOffset <= 10 && attendancePending) return "attendance";
  if (!workshopStepComplete(item)) return "workshop";
  if (!item.expenseInvoice) return "balance";
  return "management";
}

export function daysUntilAttendanceConfirmation(item: CollisionCaseRecord, todayDateKey: string): number | null {
  if (isFinalStatus(item.status)) return null;
  if (typeof item.clientWillAttend === "boolean" && typeof item.legalAssistanceRequested === "boolean") return null;
  const trialOffset = item.trialDate ? calendarDayOffsetFromKeys(item.trialDate, todayDateKey) : null;
  if (trialOffset === null || trialOffset <= 10) return null;
  return trialOffset - 10;
}

export function availableJudicialCaseTabs(item: CollisionCaseRecord, todayDateKey: string): JudicialCaseTab[] {
  const finalStatus = isFinalStatus(item.status);
  const workshopComplete = workshopStepComplete(item);
  const tabs: JudicialCaseTab[] = ["summary"];
  if (item.documentationPending) return ["summary", "follow_up", "history"];
  if (!finalStatus) tabs.push("attendance", "follow_up");
  tabs.push("history");
  if (!finalStatus || workshopComplete) tabs.push("workshop");
  if (workshopComplete && (!finalStatus || item.expenseInvoice)) tabs.push("balance");
  if (finalStatus || (Boolean(item.expenseInvoice) && Boolean(item.trialDate) && item.trialDate <= todayDateKey)) tabs.push("outcome");
  if (item.status === "ABSUELTO" && item.judicialResolutionEvidence) tabs.push("insurance");
  return tabs;
}

export function defaultJudicialCaseTab(item: CollisionCaseRecord, todayDateKey: string): JudicialCaseTab {
  if (item.documentationPending) return "summary";
  if (!isFinalStatus(item.status)) {
    const pendingStep = nextPendingJudicialStep(item, todayDateKey);
    if (pendingStep === "outcome") return "outcome";
    if (pendingStep === "attendance") return "attendance";
    if (pendingStep === "workshop") return "workshop";
    if (pendingStep === "balance") return "balance";
  }
  if (item.status === "ABSUELTO") {
    if (item.judicialResolutionEvidence && !item.insuranceClaim?.insuranceClaimId) return "insurance";
    return "outcome";
  }
  const latestFollowUp = item.judicialFollowUps[item.judicialFollowUps.length - 1];
  if (latestFollowUp?.nextActionDate && latestFollowUp.nextActionDate <= todayDateKey) return "follow_up";
  return "summary";
}
