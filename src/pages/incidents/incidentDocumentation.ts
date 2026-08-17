export type DocumentationAlertState = {
  hoursPending: number;
  severity: "attention" | "urgent";
  title: "Pendiente" | "Documentación no recibida" | "Documentación vencida";
};

export function documentationAlertState(pendingSince: string | null | undefined, now = new Date()): DocumentationAlertState {
  const timestamp = pendingSince ? new Date(pendingSince).getTime() : Number.NaN;
  const hoursPending = Number.isFinite(timestamp) ? Math.max(0, Math.floor((now.getTime() - timestamp) / 3_600_000)) : 0;
  if (hoursPending >= 48) return { hoursPending, severity: "urgent", title: "Documentación vencida" };
  if (hoursPending >= 24) return { hoursPending, severity: "urgent", title: "Documentación no recibida" };
  return { hoursPending, severity: "attention", title: "Pendiente" };
}
