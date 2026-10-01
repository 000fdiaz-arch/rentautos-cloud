import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../format";
import { supabase } from "../../lib/supabase";
import type { Client } from "../../types";
import { loadNotifiedPayments, parseNotifiedPayments, saveNotifiedPayments } from "./paymentStorage";
import type {
  NotifiedPayment,
  NotifiedPaymentForm,
  NotifiedSortField,
  SortDirection
} from "./paymentTypes";
import { roundMoney } from "./paymentRules";

const EMPTY_FORM: NotifiedPaymentForm = { unitId: "", amount: "" };

function getErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" && cause.message) {
    return cause.message;
  }
  return fallback;
}

type RouteLink = {
  routeReportId: string;
  routeAssignment?: string;
};

type PendingRoutePayment = {
  clientId: string;
  amount: number;
  routeAssignment?: string;
};

type Options = {
  dataOwnerUserId?: string | null;
  createRouteReview?: (clientId: string, amount: number) => Promise<RouteLink | null>;
  cancelRouteReview?: (reportId: string) => Promise<void>;
  deleteCloudNotice?: (noticeId: string) => Promise<void>;
  pendingRoutePayments?: PendingRoutePayment[];
};

function buildAdditionalPaymentConfirmation(unitId: string, amount: number, pending: PendingRoutePayment[]): string {
  const pendingTotal = roundMoney(pending.reduce((sum, payment) => sum + payment.amount, 0));
  const route = pending.find((payment) => payment.routeAssignment?.trim())?.routeAssignment?.trim();
  const existing = pending.length === 1
    ? `un pago notificado pendiente de ${formatCurrency(pendingTotal)}`
    : `${pending.length} pagos notificados pendientes por ${formatCurrency(pendingTotal)}`;
  return `${unitId} ya tiene ${existing}${route ? ` en la ruta ${route}` : ""}. ¿Agregar otro pago de ${formatCurrency(amount)}?`;
}

export default function useNotifiedPayments(clients: Client[], activeClients: Client[], options: Options = {}) {
  const [notifiedForm, setNotifiedForm] = useState<NotifiedPaymentForm>(EMPTY_FORM);
  const [notifiedPayments, setNotifiedPayments] = useState<NotifiedPayment[]>(() => loadNotifiedPayments());
  const [editingNotifiedId, setEditingNotifiedId] = useState<string | null>(null);
  const [editingNotifiedForm, setEditingNotifiedForm] = useState<NotifiedPaymentForm>(EMPTY_FORM);
  const [notifiedSortField, setNotifiedSortField] = useState<NotifiedSortField>("createdAt");
  const [notifiedSortDirection, setNotifiedSortDirection] = useState<SortDirection>("desc");
  const [notifiedUntilNoonOnly, setNotifiedUntilNoonOnly] = useState(false);
  const [notifiedErrors, setNotifiedErrors] = useState<string[]>([]);
  const [notifiedSavingId, setNotifiedSavingId] = useState<string | null>(null);

  useEffect(() => {
    const ownerUserId = options.dataOwnerUserId;
    if (!ownerUserId || !supabase) return;

    const channel = supabase
      .channel(`payments-notified-live-${ownerUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notified_payments_cloud", filter: `user_id=eq.${ownerUserId}` },
        (payload) => {
          const eventType = payload.eventType;
          const rawRow = (eventType === "DELETE" ? payload.old : payload.new) as { id?: unknown; data?: unknown } | null;
          const rowId = typeof rawRow?.id === "string" ? rawRow.id : "";
          if (!rowId) return;
          if (eventType === "DELETE") {
            setNotifiedPayments((current) => current.filter((row) => row.id !== rowId));
            return;
          }
          const parsed = parseNotifiedPayments([rawRow?.data])[0];
          if (!parsed) return;
          setNotifiedPayments((current) => [...current.filter((row) => row.id !== rowId), parsed]);
        }
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [options.dataOwnerUserId]);

  const notifiedRows = useMemo(() => {
    const getClient = (clientId: string): Client | null => clients.find((client) => client.id === clientId) ?? null;
    const direction = notifiedSortDirection === "asc" ? 1 : -1;
    return [...notifiedPayments].sort((left, right) => {
      if (notifiedSortField === "amount") {
        const comparison = (left.amount - right.amount) * direction;
        if (comparison !== 0) return comparison;
      } else if (notifiedSortField === "unit") {
        const leftUnit = (getClient(left.clientId)?.unitId ?? "").toLowerCase();
        const rightUnit = (getClient(right.clientId)?.unitId ?? "").toLowerCase();
        const comparison = leftUnit.localeCompare(rightUnit) * direction;
        if (comparison !== 0) return comparison;
      } else if (notifiedSortField === "client") {
        const leftName = (getClient(left.clientId)?.name ?? "").toLowerCase();
        const rightName = (getClient(right.clientId)?.name ?? "").toLowerCase();
        const comparison = leftName.localeCompare(rightName) * direction;
        if (comparison !== 0) return comparison;
      } else {
        const comparison = left.createdAt.localeCompare(right.createdAt) * direction;
        if (comparison !== 0) return comparison;
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [clients, notifiedPayments, notifiedSortDirection, notifiedSortField]);

  const notifiedRowsFiltered = useMemo(() => {
    if (!notifiedUntilNoonOnly) return notifiedRows;
    return notifiedRows.filter((row) => {
      const createdAt = new Date(row.createdAt);
      if (Number.isNaN(createdAt.getTime())) return false;
      return createdAt.getHours() < 12 || (
        createdAt.getHours() === 12 && createdAt.getMinutes() === 0 && createdAt.getSeconds() === 0
      );
    });
  }, [notifiedRows, notifiedUntilNoonOnly]);

  const notifiedClientMatch = useMemo(() => {
    const unit = notifiedForm.unitId.trim().toLowerCase();
    if (!unit) return undefined;
    return activeClients.find((client) => (client.activeProvisionalRental?.unitId ?? client.unitId).trim().toLowerCase() === unit);
  }, [activeClients, notifiedForm.unitId]);

  const editingNotifiedClientMatch = useMemo(() => {
    const unit = editingNotifiedForm.unitId.trim().toLowerCase();
    if (!unit) return undefined;
    return activeClients.find((client) => (client.activeProvisionalRental?.unitId ?? client.unitId).trim().toLowerCase() === unit);
  }, [activeClients, editingNotifiedForm.unitId]);

  const replaceNotifiedPayments = useCallback((rows: NotifiedPayment[]): void => {
    setNotifiedPayments(rows);
    saveNotifiedPayments(rows);
  }, []);

  function validate(form: NotifiedPaymentForm, client: Client | null | undefined): string[] {
    const errors: string[] = [];
    const unit = form.unitId.trim();
    if (!unit) errors.push("Debes indicar la unidad del pago notificado.");
    if (unit && !client) errors.push(`No existe un cliente activo con la unidad "${unit}".`);
    const amount = Number.parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push("El monto notificado debe ser mayor a 0.");
    return errors;
  }

  async function handleAddNotifiedPayment(): Promise<void> {
    const errors = validate(notifiedForm, notifiedClientMatch);
    if (errors.length > 0) {
      setNotifiedErrors(errors);
      return;
    }
    setNotifiedErrors([]);
    if (!notifiedClientMatch) return;
    const amount = roundMoney(Number.parseFloat(notifiedForm.amount));
    const pendingRoutePayments = options.pendingRoutePayments?.filter((payment) => payment.clientId === notifiedClientMatch.id) ?? [];
    if (pendingRoutePayments.length > 0) {
      const unitId = notifiedClientMatch.activeProvisionalRental?.unitId ?? notifiedClientMatch.unitId;
      if (!window.confirm(buildAdditionalPaymentConfirmation(unitId, amount, pendingRoutePayments))) return;
    }
    setNotifiedSavingId("new");
    try {
      const routeLink = await options.createRouteReview?.(notifiedClientMatch.id, amount) ?? null;
      replaceNotifiedPayments([...notifiedPayments, {
        id: crypto.randomUUID(),
        clientId: notifiedClientMatch.id,
        amount,
        createdAt: new Date().toISOString(),
        paymentMethod: "bank",
        routeReportId: routeLink?.routeReportId,
        routePaymentMethod: routeLink ? "bank" : undefined,
        routeAssignment: routeLink?.routeAssignment
      }]);
      setNotifiedForm(EMPTY_FORM);
    } catch (cause) {
      console.error("No se pudo guardar el pago notificado.", cause);
      setNotifiedErrors([getErrorMessage(cause, "No se pudo guardar el pago notificado.")]);
    } finally {
      setNotifiedSavingId(null);
    }
  }

  async function handleDeleteNotifiedPayment(row: NotifiedPayment): Promise<void> {
    setNotifiedSavingId(row.id);
    setNotifiedErrors([]);
    try {
      if (row.routeReportId) await options.cancelRouteReview?.(row.routeReportId);
      await options.deleteCloudNotice?.(row.id);
      replaceNotifiedPayments(notifiedPayments.filter((current) => current.id !== row.id));
    } catch (cause) {
      console.error("No se pudo devolver el pago notificado.", cause);
      setNotifiedErrors([getErrorMessage(cause, "No se pudo devolver el pago notificado.")]);
    } finally {
      setNotifiedSavingId(null);
    }
  }

  function handleStartEditNotified(row: NotifiedPayment): void {
    if (row.routeReportId) return;
    const client = clients.find((candidate) => candidate.id === row.clientId);
    setEditingNotifiedId(row.id);
    setEditingNotifiedForm({ unitId: client?.activeProvisionalRental?.unitId ?? client?.unitId ?? "", amount: String(row.amount) });
    setNotifiedErrors([]);
  }

  function handleCancelEditNotified(): void {
    setEditingNotifiedId(null);
    setEditingNotifiedForm(EMPTY_FORM);
  }

  function handleSaveEditNotified(row: NotifiedPayment): void {
    const errors = validate(editingNotifiedForm, editingNotifiedClientMatch);
    if (errors.length > 0) {
      setNotifiedErrors(errors);
      return;
    }
    if (!editingNotifiedClientMatch) return;
    replaceNotifiedPayments(notifiedPayments.map((current) => current.id === row.id
      ? {
          ...current,
          clientId: editingNotifiedClientMatch.id,
          amount: roundMoney(Number.parseFloat(editingNotifiedForm.amount))
        }
      : current
    ));
    handleCancelEditNotified();
  }

  function handleSortNotified(field: NotifiedSortField): void {
    if (notifiedSortField === field) {
      setNotifiedSortDirection((current) => current === "desc" ? "asc" : "desc");
      return;
    }
    setNotifiedSortField(field);
    setNotifiedSortDirection("desc");
  }

  return {
    notifiedForm,
    setNotifiedForm,
    notifiedPayments,
    replaceNotifiedPayments,
    editingNotifiedId,
    editingNotifiedForm,
    setEditingNotifiedForm,
    notifiedSortField,
    notifiedSortDirection,
    notifiedUntilNoonOnly,
    setNotifiedUntilNoonOnly,
    notifiedErrors,
    notifiedSavingId,
    notifiedRowsFiltered,
    notifiedClientMatch,
    editingNotifiedClientMatch,
    handleAddNotifiedPayment,
    handleDeleteNotifiedPayment,
    handleStartEditNotified,
    handleCancelEditNotified,
    handleSaveEditNotified,
    handleSortNotified
  };
}
