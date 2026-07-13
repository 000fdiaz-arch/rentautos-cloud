import { useMemo, useState } from "react";
import type { Client } from "../../types";
import { loadNotifiedPayments, saveNotifiedPayments } from "./paymentStorage";
import type {
  NotifiedPayment,
  NotifiedPaymentForm,
  NotifiedSortField,
  SortDirection
} from "./paymentTypes";
import { roundMoney } from "./paymentRules";

const EMPTY_FORM: NotifiedPaymentForm = { unitId: "", amount: "" };

export default function useNotifiedPayments(clients: Client[], activeClients: Client[]) {
  const [notifiedForm, setNotifiedForm] = useState<NotifiedPaymentForm>(EMPTY_FORM);
  const [notifiedPayments, setNotifiedPayments] = useState<NotifiedPayment[]>(() => loadNotifiedPayments());
  const [editingNotifiedId, setEditingNotifiedId] = useState<string | null>(null);
  const [editingNotifiedForm, setEditingNotifiedForm] = useState<NotifiedPaymentForm>(EMPTY_FORM);
  const [notifiedSortField, setNotifiedSortField] = useState<NotifiedSortField>("createdAt");
  const [notifiedSortDirection, setNotifiedSortDirection] = useState<SortDirection>("desc");
  const [notifiedUntilNoonOnly, setNotifiedUntilNoonOnly] = useState(false);
  const [notifiedErrors, setNotifiedErrors] = useState<string[]>([]);

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
    return activeClients.find((client) => client.unitId.trim().toLowerCase() === unit);
  }, [activeClients, notifiedForm.unitId]);

  const editingNotifiedClientMatch = useMemo(() => {
    const unit = editingNotifiedForm.unitId.trim().toLowerCase();
    if (!unit) return undefined;
    return activeClients.find((client) => client.unitId.trim().toLowerCase() === unit);
  }, [activeClients, editingNotifiedForm.unitId]);

  function replaceNotifiedPayments(rows: NotifiedPayment[]): void {
    setNotifiedPayments(rows);
    saveNotifiedPayments(rows);
  }

  function validate(form: NotifiedPaymentForm, client: Client | null | undefined): string[] {
    const errors: string[] = [];
    const unit = form.unitId.trim();
    if (!unit) errors.push("Debes indicar la unidad del pago notificado.");
    if (unit && !client) errors.push(`No existe un cliente activo con la unidad "${unit}".`);
    const amount = Number.parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push("El monto notificado debe ser mayor a 0.");
    return errors;
  }

  function handleAddNotifiedPayment(): void {
    const errors = validate(notifiedForm, notifiedClientMatch);
    if (errors.length > 0) {
      setNotifiedErrors(errors);
      return;
    }
    setNotifiedErrors([]);
    if (!notifiedClientMatch) return;
    replaceNotifiedPayments([...notifiedPayments, {
      id: crypto.randomUUID(),
      clientId: notifiedClientMatch.id,
      amount: roundMoney(Number.parseFloat(notifiedForm.amount)),
      createdAt: new Date().toISOString()
    }]);
    setNotifiedForm(EMPTY_FORM);
  }

  function handleDeleteNotifiedPayment(id: string): void {
    replaceNotifiedPayments(notifiedPayments.filter((row) => row.id !== id));
  }

  function handleStartEditNotified(row: NotifiedPayment): void {
    const client = clients.find((candidate) => candidate.id === row.clientId);
    setEditingNotifiedId(row.id);
    setEditingNotifiedForm({ unitId: client?.unitId ?? "", amount: String(row.amount) });
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
