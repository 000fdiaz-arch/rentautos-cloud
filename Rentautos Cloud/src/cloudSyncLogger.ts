type CloudSyncLogLevel = "info" | "error";

export type CloudSyncLogPayload = {
  operation: string;
  table?: string;
  userId?: string;
  durationMs: number;
  requestCount: number;
  payloadSummary?: string;
  responseSummary?: string;
  error?: unknown;
};

function normalizeError(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function logCloudSync(level: CloudSyncLogLevel, payload: CloudSyncLogPayload): void {
  const base = {
    tag: "cloud-sync",
    operation: payload.operation,
    table: payload.table ?? "",
    user_id: payload.userId ?? "",
    duration_ms: Math.max(0, Math.round(payload.durationMs)),
    request_count: Math.max(0, payload.requestCount),
    payload: payload.payloadSummary ?? "",
    response: payload.responseSummary ?? ""
  };

  if (level === "error") {
    console.error("[CloudSync]", { ...base, error: normalizeError(payload.error) });
    return;
  }
  console.info("[CloudSync]", base);
}
