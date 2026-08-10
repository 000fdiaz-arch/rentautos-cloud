import { useMemo, useState, type RefObject } from "react";
import { formatCurrency } from "../../format";
import type { BankRule, Payment, PaymentIncomeEdit } from "../../types";
import { getBusinessDateKey } from "../../billing";
import { BANK_PAYMENT_METHODS } from "./paymentConstants";
import { PAYMENT_METHODS } from "./paymentConstants";
import {
  buildDailyIncomeGroups,
  buildDeliveredFromPreviousRows,
  buildPendingDeliveryRows,
  getDailyIncomeStatus,
  getDailyIncomeReportDate,
  getDailyIncomeDestination,
  getIncomeDate,
  isMoneyDelivered,
  maskAccountNumber
} from "./dailyIncomeRules";

type Props = {
  sectionRef: RefObject<HTMLElement>;
  isOpen: boolean;
  payments: Payment[];
  bankRules: BankRule[];
  onPaymentsChange: (payments: Payment[]) => void;
  currentActor: string;
  readOnly?: boolean;
  isPaymentHistoryLoaded?: boolean;
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

function formatCommentDate(payment: Payment): string {
  const edits = payment.incomeEdits ?? [];
  const commentEdit = [...edits].reverse().find((edit) => (
    edit.previousComment !== undefined || edit.nextComment !== undefined
  ));
  if (!commentEdit) return "Fecha no registrada";
  const date = new Date(commentEdit.createdAt);
  if (!Number.isFinite(date.getTime())) return "Fecha no registrada";
  return `Colocado el ${date.toLocaleString("es-PA", { dateStyle: "short", timeStyle: "short" })}`;
}

function formatMoneyDay(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return dateKey;
  return date.toLocaleDateString("es-PA", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

function getDeliveryContext(payment: Payment): string {
  const moneyDate = getIncomeDate(payment);
  if (!isMoneyDelivered(payment)) return `Pendiente · dinero del ${formatMoneyDay(moneyDate)}`;
  if (payment.moneyDeliveryDate && payment.moneyDeliveryDate > moneyDate) {
    return `Entregado el ${formatMoneyDay(payment.moneyDeliveryDate)} · dinero del ${formatMoneyDay(moneyDate)}`;
  }
  return `Dinero del ${formatMoneyDay(moneyDate)}`;
}

export default function DailyIncomePanel({
  sectionRef,
  isOpen,
  payments,
  bankRules,
  onPaymentsChange,
  currentActor,
  readOnly = false,
  isPaymentHistoryLoaded = true
}: Props) {
  const [dateKey, setDateKey] = useState(getBusinessDateKey());
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editAccount, setEditAccount] = useState("");
  const [editComment, setEditComment] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState("");

  const rawGroups = useMemo(() => buildDailyIncomeGroups(payments, dateKey), [payments, dateKey]);
  const destinationOptions = useMemo(() => rawGroups.map((group) => ({ key: group.key, label: group.label })), [rawGroups]);
  const filteredPayments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return payments.filter((payment) => {
      const status = getDailyIncomeStatus(payment);
      if (methodFilter !== "all" && payment.paymentMethod !== methodFilter) return false;
      if (destinationFilter !== "all" && getDailyIncomeDestination(payment).key !== destinationFilter) return false;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (deliveryFilter !== "all") {
        if (status === "non_cash") return false;
        if (deliveryFilter === "yes" && !isMoneyDelivered(payment)) return false;
        if (deliveryFilter === "no" && isMoneyDelivered(payment)) return false;
      }
      if (normalizedSearch && ![
        payment.clientName,
        payment.clientUnit,
        payment.receiptNumber,
        payment.reference ?? "",
        payment.incomeComment ?? "",
        payment.bankAccountNumber ?? "",
        payment.paymentMethod
      ].some((value) => value.toLowerCase().includes(normalizedSearch))) return false;
      return true;
    });
  }, [payments, search, methodFilter, destinationFilter, statusFilter, deliveryFilter]);
  const groups = useMemo(() => buildDailyIncomeGroups(filteredPayments, dateKey), [filteredPayments, dateKey]);
  const pendingDeliveries = useMemo(() => buildPendingDeliveryRows(filteredPayments, dateKey), [filteredPayments, dateKey]);
  const pendingDeliveriesTotal = pendingDeliveries.reduce((sum, payment) => sum + payment.amountReceived, 0);
  const deliveredFromPrevious = useMemo(() => buildDeliveredFromPreviousRows(filteredPayments, dateKey), [filteredPayments, dateKey]);
  const deliveredFromPreviousTotal = deliveredFromPrevious.reduce((sum, payment) => sum + payment.amountReceived, 0);
  const receivedTotal = groups.filter((group) => group.status === "received").reduce((sum, group) => sum + group.total, 0);
  const pendingTotal = groups.filter((group) => group.status === "pending").reduce((sum, group) => sum + group.total, 0);
  const nonCashTotal = groups.filter((group) => group.status === "non_cash").reduce((sum, group) => sum + group.total, 0);
  const receivedCount = groups.filter((group) => group.status === "received").reduce((sum, group) => sum + group.payments.length, 0);
  const accountOptions = bankRules.filter((rule) => rule.active);
  const filtersActive = search.trim() !== "" || methodFilter !== "all" || destinationFilter !== "all" || statusFilter !== "all" || deliveryFilter !== "all";

  function clearFilters(): void {
    setSearch("");
    setMethodFilter("all");
    setDestinationFilter("all");
    setStatusFilter("all");
    setDeliveryFilter("all");
  }

  function toggleStatusFilter(status: "received" | "pending" | "non_cash"): void {
    setStatusFilter((current) => current === status ? "all" : status);
  }

  function toggleGroup(key: string): void {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function openEdit(payment: Payment): void {
    setEditingPayment(payment);
    setEditAccount(payment.bankAccountNumber ?? "");
    setEditComment(payment.incomeComment ?? "");
    setEditReason("");
    setEditError("");
  }

  function changeMoneyDelivered(payment: Payment, delivered: boolean): void {
    const previousDelivered = isMoneyDelivered(payment);
    if (previousDelivered === delivered) return;
    const changedAt = new Date().toISOString();
    const audit: PaymentIncomeEdit = {
      id: crypto.randomUUID(),
      createdAt: changedAt,
      actor: currentActor,
      reason: delivered ? "Dinero marcado como entregado" : "Dinero marcado como pendiente de entrega",
      previousMoneyDelivered: previousDelivered,
      nextMoneyDelivered: delivered
    };
    onPaymentsChange(payments.map((row) => row.id === payment.id ? {
      ...row,
      moneyDelivered: delivered,
      moneyDeliveryDate: delivered ? dateKey : undefined,
      moneyDeliveryUpdatedAt: changedAt,
      moneyDeliveryUpdatedBy: currentActor,
      incomeEdits: [...(row.incomeEdits ?? []), audit]
    } : row));
  }

  function saveEdit(): void {
    if (!editingPayment) return;
    const nextAccount = editAccount.trim();
    const previousAccount = editingPayment.bankAccountNumber?.trim() ?? "";
    const nextComment = editComment.trim();
    const previousComment = editingPayment.incomeComment?.trim() ?? "";
    const accountChanged = nextAccount !== previousAccount;
    const commentChanged = nextComment !== previousComment;
    if (!accountChanged && !commentChanged) {
      setEditingPayment(null);
      return;
    }
    if (accountChanged && !editReason.trim()) {
      setEditError("Indica el motivo de la corrección de cuenta.");
      return;
    }
    const matchedRule = accountOptions.find((rule) => rule.accountNumber === nextAccount);
    const audit: PaymentIncomeEdit = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      actor: currentActor,
      reason: editReason.trim() || undefined,
      previousAccountNumber: previousAccount || undefined,
      nextAccountNumber: nextAccount || undefined,
      previousComment: commentChanged ? previousComment || undefined : undefined,
      nextComment: commentChanged ? nextComment || undefined : undefined
    };
    onPaymentsChange(payments.map((payment) => payment.id === editingPayment.id ? {
      ...payment,
      bankAccountNumber: nextAccount || undefined,
      bankGroupCode: matchedRule?.groupCode || (nextAccount === previousAccount ? payment.bankGroupCode : undefined),
      incomeComment: nextComment || undefined,
      incomeEdits: [...(payment.incomeEdits ?? []), audit]
    } : payment));
    setEditingPayment(null);
  }

  async function exportExcel(): Promise<void> {
    const rows = groups.flatMap((group) => group.payments.map((payment) => ({
      Fecha: getIncomeDate(payment),
      "Fecha en que suma": getDailyIncomeReportDate(payment),
      Hora: formatTime(payment.createdAt),
      Estado: getDailyIncomeStatus(payment) === "received" ? "Recibido" : getDailyIncomeStatus(payment) === "pending" ? "Pendiente" : "Sin entrada de dinero",
      Destino: group.label,
      Cuenta: payment.bankAccountNumber ?? "",
      Forma: payment.paymentMethod,
      Recibo: payment.receiptNumber,
      Unidad: payment.clientUnit,
      Cliente: payment.clientName,
      Referencia: payment.reference ?? "",
      Comentario: payment.incomeComment ?? "",
      "Fecha del comentario": payment.incomeComment ? formatCommentDate(payment) : "",
      "Dinero entregado": getDailyIncomeStatus(payment) === "non_cash" ? "No aplica" : isMoneyDelivered(payment) ? "Sí" : "No",
      "Día al que corresponde el dinero": getIncomeDate(payment),
      "Fecha de entrega": payment.moneyDeliveryDate ?? "",
      Monto: payment.amountReceived
    })));
    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const summary = xlsx.utils.aoa_to_sheet([
      ["Ingresos del día", dateKey],
      ["Destino", "Estado", "Pagos", "Total"],
      ...groups.map((group) => [group.label, group.status, group.payments.length, group.total]),
      [],
      ["Total recibido", receivedTotal],
      ["Pendiente de acreditación", pendingTotal],
      ["Movimientos sin entrada", nonCashTotal]
    ]);
    const detail = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(workbook, summary, "Resumen");
    xlsx.utils.book_append_sheet(workbook, detail, "Movimientos");
    xlsx.writeFile(workbook, `ingresos-del-dia-${dateKey}.xlsx`);
  }

  return (
    <section id="payment-panel-income" role="tabpanel" aria-labelledby="payment-tab-income" ref={sectionRef} className="panel income-day-panel" style={{ display: isOpen ? undefined : "none" }}>
      <div className="income-day-header">
        <div>
          <h2>Ingresos del día</h2>
          <p className="hint">Dinero recibido, agrupado por la cuenta o el medio donde cayó.</p>
        </div>
        <div className="income-day-actions">
          <label>Fecha<input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} /></label>
          <button type="button" className="button ghost" onClick={() => void exportExcel()}>Exportar Excel</button>
        </div>
      </div>

      {!isPaymentHistoryLoaded && <p className="hint">El historial completo todavía está cargando; los totales pueden cambiar.</p>}
      <div className="income-day-kpis">
        <button type="button" className={statusFilter === "received" ? "income-day-kpi--active" : ""} aria-pressed={statusFilter === "received"} onClick={() => toggleStatusFilter("received")}><span>Total recibido</span><strong>{formatCurrency(receivedTotal)}</strong><small>{receivedCount} pago(s) · Ver detalle</small></button>
        <button type="button" className={`income-day-kpi--pending${statusFilter === "pending" ? " income-day-kpi--active" : ""}`} aria-pressed={statusFilter === "pending"} onClick={() => toggleStatusFilter("pending")}><span>Pendiente de acreditación</span><strong>{formatCurrency(pendingTotal)}</strong><small>Principalmente tarjetas · Ver detalle</small></button>
        <button type="button" className={`income-day-kpi--noncash${statusFilter === "non_cash" ? " income-day-kpi--active" : ""}`} aria-pressed={statusFilter === "non_cash"} onClick={() => toggleStatusFilter("non_cash")}><span>Sin entrada de dinero</span><strong>{formatCurrency(nonCashTotal)}</strong><small>Descuentos y referidos · Ver detalle</small></button>
      </div>

      {pendingDeliveries.length > 0 && <section className="income-delivery-pending" aria-label="Pendientes por entregar">
        <div className="income-delivery-pending-header">
          <div><h3>Pendientes por entregar</h3><p>Marcados como “No” en días anteriores.</p></div>
          <strong>{formatCurrency(pendingDeliveriesTotal)}</strong>
        </div>
        <div className="income-day-table-wrap">
          <table className="income-day-table">
            <thead><tr><th>Dinero correspondiente a</th><th>Unidad / cliente</th><th>Recibo</th><th>Forma</th><th>Monto</th><th>Dinero entregado</th></tr></thead>
            <tbody>{pendingDeliveries.map((payment) => <tr key={`pending-delivery-${payment.id}`}>
              <td>{getIncomeDate(payment)}</td>
              <td><strong>{payment.clientUnit}</strong><small>{payment.clientName}</small></td>
              <td>{payment.receiptNumber}</td>
              <td>{payment.paymentMethod}</td>
              <td><strong>{formatCurrency(payment.amountReceived)}</strong></td>
              <td>{readOnly ? <span className="income-delivery-badge income-delivery-badge--no">No</span> : <button type="button" className="button primary small" onClick={() => changeMoneyDelivered(payment, true)}>Marcar Sí</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}

      {deliveredFromPrevious.length > 0 && <section className="income-delivery-completed" aria-label="Entregados hoy de días anteriores">
        <div className="income-delivery-pending-header">
          <div><h3>Entregados hoy de días anteriores</h3><p>Se entregaron hoy, pero el dinero pertenece a la fecha indicada.</p></div>
          <strong>{formatCurrency(deliveredFromPreviousTotal)}</strong>
        </div>
        <div className="income-day-table-wrap">
          <table className="income-day-table">
            <thead><tr><th>Dinero correspondiente a</th><th>Unidad / cliente</th><th>Recibo</th><th>Forma</th><th>Monto</th><th>Entrega</th></tr></thead>
            <tbody>{deliveredFromPrevious.map((payment) => <tr key={`completed-delivery-${payment.id}`}>
              <td>{formatMoneyDay(getIncomeDate(payment))}</td>
              <td><strong>{payment.clientUnit}</strong><small>{payment.clientName}</small></td>
              <td>{payment.receiptNumber}</td>
              <td>{payment.paymentMethod}</td>
              <td><strong>{formatCurrency(payment.amountReceived)}</strong></td>
              <td><span className="income-delivery-badge income-delivery-badge--yes">Entregado hoy</span></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}

      <div className="income-day-filters" aria-label="Filtros de ingresos">
        <label className="income-day-search">Buscar<input type="search" placeholder="Cliente, unidad, recibo o referencia" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Forma de pago<select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}><option value="all">Todas</option>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
        <label>Cuenta o destino<select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)}><option value="all">Todos</option>{destinationOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="received">Recibido</option><option value="pending">Pendiente</option><option value="non_cash">Sin entrada de dinero</option></select></label>
        <label>Dinero entregado<select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value)}><option value="all">Todos</option><option value="yes">Sí</option><option value="no">No</option></select></label>
        <button type="button" className="button ghost" onClick={clearFilters} disabled={!filtersActive}>Limpiar filtros</button>
      </div>

      {groups.length === 0 && <div className="empty-state"><p>No hay movimientos para esta fecha.</p></div>}
      <div className="income-day-groups">
        {groups.map((group) => {
          const rows = group.payments;
          const expanded = filtersActive || expandedKeys.has(group.key);
          return (
            <article key={group.key} className={`income-day-group income-day-group--${group.status}`}>
              <button type="button" className="income-day-group-summary" onClick={() => toggleGroup(group.key)} aria-expanded={expanded}>
                <span><strong>{group.label}</strong><small>{group.payments.length} pago(s)</small></span>
                <strong>{formatCurrency(group.total)}</strong>
                <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
              </button>
              {expanded && (
                <div className="income-day-table-wrap">
                  <table className="income-day-table">
                    <thead><tr><th>Hora</th><th>Unidad / cliente</th><th>Recibo</th><th>Forma</th><th>Referencia</th><th>Comentario</th><th>Dinero entregado</th><th>Monto</th><th /></tr></thead>
                    <tbody>{rows.map((payment) => <tr key={payment.id}>
                      <td>{formatTime(payment.createdAt)}</td>
                      <td><strong>{payment.clientUnit}</strong><small>{payment.clientName}</small></td>
                      <td>{payment.receiptNumber}</td>
                      <td>{payment.paymentMethod}{payment.bankAccountNumber && <small>{maskAccountNumber(payment.bankAccountNumber)}</small>}</td>
                      <td className="income-day-reference">{payment.reference || "—"}</td>
                      <td>{payment.incomeComment || "—"}{payment.incomeComment && <small>{formatCommentDate(payment)}</small>}{getDailyIncomeStatus(payment) !== "non_cash" && <small className="income-delivery-context">{getDeliveryContext(payment)}</small>}{(payment.incomeEdits?.length ?? 0) > 0 && <small>Última edición: {payment.incomeEdits?.[payment.incomeEdits.length - 1]?.actor}</small>}</td>
                      <td>{getDailyIncomeStatus(payment) === "non_cash" ? <span className="income-delivery-badge">No aplica</span> : readOnly ? <span className={`income-delivery-badge ${isMoneyDelivered(payment) ? "income-delivery-badge--yes" : "income-delivery-badge--no"}`}>{isMoneyDelivered(payment) ? "Sí" : "No"}</span> : <select className={`income-delivery-select ${isMoneyDelivered(payment) ? "income-delivery-select--yes" : "income-delivery-select--no"}`} aria-label={`Dinero entregado ${payment.receiptNumber}`} value={isMoneyDelivered(payment) ? "yes" : "no"} onChange={(event) => changeMoneyDelivered(payment, event.target.value === "yes")}><option value="yes">Sí</option><option value="no">No</option></select>}</td>
                      <td><strong>{formatCurrency(payment.amountReceived)}</strong></td>
                      <td>{!readOnly && <button type="button" className="button ghost small" onClick={() => openEdit(payment)}>Editar</button>}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {editingPayment && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingPayment(null); }}>
        <div className="modal income-edit-modal" role="dialog" aria-modal="true" aria-labelledby="income-edit-title">
          <div className="modal-header"><h2 id="income-edit-title">Editar ingreso {editingPayment.receiptNumber}</h2><button type="button" className="modal-close" onClick={() => setEditingPayment(null)}>×</button></div>
          <div className="modal-body income-edit-form">
            {BANK_PAYMENT_METHODS.has(editingPayment.paymentMethod) || editingPayment.paymentMethod === "Tarjeta" ? <label>Cuenta receptora
              <select value={editAccount} onChange={(event) => setEditAccount(event.target.value)}>
                <option value="">Cuenta no identificada</option>
                {editAccount && !accountOptions.some((rule) => rule.accountNumber === editAccount) && <option value={editAccount}>Actual · {maskAccountNumber(editAccount)}</option>}
                {accountOptions.map((rule) => <option key={rule.id} value={rule.accountNumber}>{rule.groupCode} · {maskAccountNumber(rule.accountNumber)}</option>)}
              </select>
            </label> : null}
            <label>Comentario<textarea rows={3} value={editComment} onChange={(event) => setEditComment(event.target.value)} placeholder="Comentario opcional" /></label>
            {editAccount.trim() !== (editingPayment.bankAccountNumber?.trim() ?? "") && <label>Motivo de la corrección<input value={editReason} onChange={(event) => setEditReason(event.target.value)} placeholder="Obligatorio al cambiar la cuenta" /></label>}
            {editError && <p className="hint error-text">{editError}</p>}
            {(editingPayment.incomeEdits?.length ?? 0) > 0 && <details><summary>Historial de ediciones ({editingPayment.incomeEdits?.length})</summary><ul className="income-edit-audit">{[...(editingPayment.incomeEdits ?? [])].reverse().map((edit) => <li key={edit.id}><strong>{edit.actor}</strong> · {new Date(edit.createdAt).toLocaleString("es-PA")}{edit.reason ? ` · ${edit.reason}` : ""}</li>)}</ul></details>}
            <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditingPayment(null)}>Cancelar</button><button type="button" className="button primary" onClick={saveEdit}>Guardar cambios</button></div>
          </div>
        </div>
      </div>}
    </section>
  );
}
