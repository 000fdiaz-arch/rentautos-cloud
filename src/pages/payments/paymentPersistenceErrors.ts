function errorParts(error: unknown): {
  code: string;
  message: string;
  details: string;
  hint: string;
  normalized: string;
} {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === "string"
      ? record.message
      : "";
  const details = typeof record?.details === "string" ? record.details : "";
  const hint = typeof record?.hint === "string" ? record.hint : "";
  return {
    code,
    message,
    details,
    hint,
    normalized: `${code} ${message} ${details} ${hint}`.toLowerCase()
  };
}

export function getPaymentSaveErrorMessage(error: unknown): string {
  const { code, message, details, hint, normalized } = errorParts(error);

  if (
    normalized.includes("payments_cloud_user_receipt_number_uq") ||
    normalized.includes("receiptnumber")
  ) {
    return "No se pudo guardar: el numero de recibo ya existe en Supabase. Actualiza el historial y vuelve a intentar.";
  }
  if (
    normalized.includes("payments_cloud_user_folio_uq") ||
    normalized.includes("pending_bank_items_cloud_user_folio_uq") ||
    normalized.includes("pending_card_items_cloud_user_folio_uq")
  ) {
    return "No se pudo guardar: el folio ya existe en Supabase.";
  }
  if (
    normalized.includes("row-level security") ||
    normalized.includes("permission denied") ||
    normalized.includes("42501")
  ) {
    return "No se pudo guardar por permisos de Supabase. Verifica el usuario/owner y vuelve a intentar.";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("timeout")
  ) {
    return "No se pudo guardar por conexion lenta o inestable. Revisa internet y vuelve a intentar.";
  }

  const diagnostic = [code, message, details, hint]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" | ");
  return diagnostic
    ? `No se pudo guardar el pago. Motivo: ${diagnostic.slice(0, 180)}`
    : "No se pudo guardar el pago. Revisa la consola e intenta nuevamente.";
}

export function isReceiptNumberConflict(error: unknown): boolean {
  const { normalized } = errorParts(error);
  return normalized.includes("payments_cloud_user_receipt_number_uq") ||
    normalized.includes("receiptnumber");
}
