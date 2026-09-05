import type { LeadEvaluation } from "../types";
import { dedupeLoad, getCloudClient } from "./cloudClient";
import { normalizeLeadEvaluationSummary } from "./operationsCloudData";

export const LEAD_PAGE_SIZE = 20;
export type LeadCursor = { updatedAt: string; id: string };
export type LeadPage = { items: LeadEvaluation[]; nextCursor: LeadCursor | null };
type SummaryRow = { id: string; summary: LeadEvaluation; updated_at: string };

async function readSummaries(userId: string, cedula: string | null, cursor: LeadCursor | null): Promise<SummaryRow[]> {
  return dedupeLoad(`lead-page:${userId}:${cedula ?? ""}:${JSON.stringify(cursor)}`, async () => {
    const { data, error } = await getCloudClient().rpc("read_lead_evaluations_page", {
      p_user_id: userId,
      p_cedula: cedula,
      p_before_updated_at: cursor?.updatedAt ?? null,
      p_before_id: cursor?.id ?? null
    });
    if (error) throw error;
    return (data ?? []) as SummaryRow[];
  });
}

function evaluationFromRow(row: SummaryRow): LeadEvaluation {
  return normalizeLeadEvaluationSummary({ ...row.summary, id: row.id });
}

export async function loadCloudLeadPage(userId: string, cursor: LeadCursor | null = null): Promise<LeadPage> {
  const rows = await readSummaries(userId, null, cursor);
  const visible = rows.slice(0, LEAD_PAGE_SIZE);
  const last = visible[visible.length - 1];
  return {
    items: visible.map(evaluationFromRow),
    nextCursor: rows.length > LEAD_PAGE_SIZE && last ? { id: last.id, updatedAt: last.updated_at } : null
  };
}

export async function findCloudLeadByCedula(userId: string, cedula: string): Promise<LeadEvaluation | null> {
  const rows = await readSummaries(userId, cedula, null);
  return rows[0] ? evaluationFromRow(rows[0]) : null;
}
