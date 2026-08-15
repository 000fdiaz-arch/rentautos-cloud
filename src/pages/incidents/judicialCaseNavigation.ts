import type { CollisionCaseRecord } from "../../cloudData";

export type JudicialCaseTab = "summary" | "attendance" | "follow_up" | "history" | "workshop" | "balance" | "outcome" | "insurance";

function isFinalStatus(status: CollisionCaseRecord["status"]): boolean {
  return status === "ABSUELTO" || status === "CULPABLE";
}

function workshopStepComplete(item: CollisionCaseRecord): boolean {
  return Boolean(item.vehicleInspectedAt || item.expenseInvoice);
}

export function availableJudicialCaseTabs(item: CollisionCaseRecord, todayDateKey: string): JudicialCaseTab[] {
  const finalStatus = isFinalStatus(item.status);
  const workshopComplete = workshopStepComplete(item);
  const tabs: JudicialCaseTab[] = ["summary"];
  if (!finalStatus) tabs.push("attendance", "follow_up");
  tabs.push("history");
  if (!finalStatus || workshopComplete) tabs.push("workshop");
  if (workshopComplete && (!finalStatus || item.expenseInvoice)) tabs.push("balance");
  if (finalStatus || (Boolean(item.expenseInvoice) && Boolean(item.trialDate) && item.trialDate <= todayDateKey)) tabs.push("outcome");
  if (item.status === "ABSUELTO" && item.judicialResolutionEvidence) tabs.push("insurance");
  return tabs;
}

export function defaultJudicialCaseTab(item: CollisionCaseRecord, todayDateKey: string): JudicialCaseTab {
  if (item.trialDate && item.trialDate <= todayDateKey && !isFinalStatus(item.status) && item.expenseInvoice) return "outcome";
  const attendancePending = !isFinalStatus(item.status)
    && (typeof item.clientWillAttend !== "boolean" || typeof item.legalAssistanceRequested !== "boolean");
  if (attendancePending) return "attendance";
  if (!isFinalStatus(item.status) && !workshopStepComplete(item)) return "workshop";
  if (!isFinalStatus(item.status) && !item.expenseInvoice) return "balance";
  if (item.status === "ABSUELTO") {
    if (item.judicialResolutionEvidence && !item.insuranceClaim?.insuranceClaimId) return "insurance";
    return "outcome";
  }
  const latestFollowUp = item.judicialFollowUps[item.judicialFollowUps.length - 1];
  if (latestFollowUp?.nextActionDate && latestFollowUp.nextActionDate <= todayDateKey) return "follow_up";
  return "summary";
}
