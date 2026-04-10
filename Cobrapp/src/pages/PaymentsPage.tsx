import { useMemo, useRef, useState } from "react";
import PaymentReceipt from "../components/PaymentReceipt";
import { formatCurrency, formatDate } from "../format";
import { nextReceiptNumber } from "../storage";
import type { Client, Payment, PaymentMethod } from "../types";
import { toDateKey } from "../billing";

const PAYMENT_METHODS: PaymentMethod[] = ["Efectivo", "ACH Express", "Deposito Bancario", "Transferencia Bancaria", "Tarjeta"];
const BANK_PAYMENT_METHODS = new Set<PaymentMethod>(["ACH Express", "Deposito Bancario", "Transferencia Bancaria"]);
const NOTIFIED_PAYMENTS_KEY = "cobrapp.module2.notified.v1";

const FREQUENCY_LABEL: Record<string, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual"
};

type PaymentForm = {
  clientId: string;
  dateApplied: string;
  paymentMethod: PaymentMethod;
  reference: string;
  amountReceived: string;
};

type NotifiedPayment = {
  id: string;
  clientId: string;
  amount: number;
  createdAt: string;
};

type NotifiedPaymentForm = {
  unitId: string;
  amount: string;
};

type Props = {
  clients: Client[];
  onClientsChange: (next: Client[]) => void;
  payments: Payment[];
  onPaymentsChange: (next: Payment[]) => void;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function loadNotifiedPayments(): NotifiedPayment[] {
  const raw = localStorage.getItem(NOTIFIED_PAYMENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is NotifiedPayment => {
        if (!item || typeof item !== "object") return false;
        const rec = item as Record<string, unknown>;
        return (
          typeof rec.id === "string" &&
          typeof rec.clientId === "string" &&
          typeof rec.amount === "number" &&
          Number.isFinite(rec.amount) &&
          typeof rec.createdAt === "string"
        );
      });
  } catch {
    return [];
  }
}

function saveNotifiedPayments(rows: NotifiedPayment[]): void {
  localStorage.setItem(NOTIFIED_PAYMENTS_KEY, JSON.stringify(rows));
}

export default function PaymentsPage({ clients, onClientsChange, payments, onPaymentsChange }: Props) {
  const [form, setForm] = useState<PaymentForm>({
    clientId: "",
    dateApplied: toDateKey(new Date()),
    paymentMethod: "Efectivo",
    reference: "",
    amountReceived: ""
  });
  const [clientSearch, setClientSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmedPayment, setConfirmedPayment] = useState<Payment | null>(null);
  const [isRegisterOpen, setIsRegisterOpen] = useState(true);
  const [isNotifiedOpen, setIsNotifiedOpen] = useState(true);
  const [historyClientId, setHistoryClientId] = useState<string>("all");
  const [historyPreviewPayment, setHistoryPreviewPayment] = useState<Payment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null);
  const [notifiedForm, setNotifiedForm] = useState<NotifiedPaymentForm>({
    unitId: "",
    amount: ""
  });
  const [notifiedPayments, setNotifiedPayments] = useState<NotifiedPayment[]>(() => loadNotifiedPayments());
  const [notifiedErrors, setNotifiedErrors] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeClients = useMemo(
    () => clients.filter((c) => !c.archivedAt),
    [clients]
  );

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return activeClients;
    return activeClients.filter((c) =>
      `${c.unitId} ${c.name} ${c.cedula ?? ""}`.toLowerCase().includes(q)
    );
  }, [activeClients, clientSearch]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === form.clientId) ?? null,
    [clients, form.clientId]
  );

  const preview = useMemo(() => {
    if (!selectedClient) return null;
    const amount = parseFloat(form.amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const balanceBefore = selectedClient.balance;
    const appliedToRent = roundMoney(Math.min(amount, balanceBefore));
    const centavosAhorro = roundMoney(Math.max(0, amount - balanceBefore));
    const balanceAfter = roundMoney(balanceBefore - appliedToRent);
    const rentAmount = selectedClient.rentAmount;
    const pendingBefore = rentAmount > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
    const pendingAfter = rentAmount > 0 && balanceAfter > 0 ? Math.ceil(balanceAfter / rentAmount) : 0;
    const installmentsDeducted = Math.max(0, pendingBefore - pendingAfter);

    return {
      balanceBefore,
      appliedToRent,
      centavosAhorro,
      balanceAfter,
      installmentsDeducted,
      pendingBefore,
      pendingAfter
    };
  }, [form.amountReceived, selectedClient]);

  const isZeroBalance = selectedClient !== null && selectedClient.balance === 0;
  const isBankPayment = BANK_PAYMENT_METHODS.has(form.paymentMethod);

  const notifiedRows = useMemo(
    () => [...notifiedPayments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notifiedPayments]
  );

  const notifiedClientMatch = useMemo(() => {
    const unit = notifiedForm.unitId.trim().toLowerCase();
    if (!unit) return null;
    return activeClients.find((c) => c.unitId.trim().toLowerCase() === unit) ?? null;
  }, [activeClients, notifiedForm.unitId]);

  function handleSelectClient(client: Client): void {
    setForm((f) => ({ ...f, clientId: client.id }));
    setClientSearch("");
    setDropdownOpen(false);
  }

  function handleClearClient(): void {
    setForm((f) => ({ ...f, clientId: "" }));
    setClientSearch("");
    setDropdownOpen(false);
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!form.clientId) errs.push("Debes seleccionar un cliente.");
    const amount = parseFloat(form.amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) errs.push("El monto recibido debe ser mayor a 0.");
    if (!form.dateApplied) errs.push("La fecha aplicada es obligatoria.");
    if (isBankPayment && !form.reference.trim()) errs.push("Debes indicar el folio/referencia para pagos bancarios.");
    return errs;
  }

  function handleConfirmPayment(): void {
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    if (!selectedClient || !preview) return;

    setErrors([]);
    const receiptNumber = nextReceiptNumber();

    const payment: Payment = {
      id: crypto.randomUUID(),
      receiptNumber,
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      clientUnit: selectedClient.unitId,
      clientCedula: selectedClient.cedula,
      dateApplied: form.dateApplied,
      paymentMethod: form.paymentMethod,
      reference: form.reference.trim() || undefined,
      amountReceived: roundMoney(parseFloat(form.amountReceived)),
      appliedToRent: preview.appliedToRent,
      centavosAhorro: preview.centavosAhorro,
      installmentsDeducted: preview.installmentsDeducted,
      balanceBefore: preview.balanceBefore,
      balanceAfter: preview.balanceAfter,
      savingsBefore: selectedClient.savings,
      savingsAfter: roundMoney(selectedClient.savings + preview.centavosAhorro),
      installmentsPaidAfter: selectedClient.installmentsPaid + preview.installmentsDeducted,
      installmentsRemainingAfter: Math.max(0, selectedClient.installmentsRemaining - preview.installmentsDeducted),
      rentAmount: selectedClient.rentAmount,
      frequency: selectedClient.frequency,
      weeklyChargeDay: selectedClient.weeklyChargeDay,
      monthlyChargeDay: selectedClient.monthlyChargeDay,
      createdAt: new Date().toISOString()
    };

    const updatedClients = clients.map((c) => {
      if (c.id !== selectedClient.id) return c;
      return {
        ...c,
        balance: preview.balanceAfter,
        savings: roundMoney(c.savings + preview.centavosAhorro),
        installmentsRemaining: Math.max(0, c.installmentsRemaining - preview.installmentsDeducted),
        installmentsPaid: c.installmentsPaid + preview.installmentsDeducted
      };
    });

    onClientsChange(updatedClients);
    onPaymentsChange([...payments, payment]);
    setConfirmedPayment(payment);
    setForm({
      clientId: "",
      dateApplied: toDateKey(new Date()),
      paymentMethod: "Efectivo",
      reference: "",
      amountReceived: ""
    });
  }

  function handleDeletePayment(payment: Payment): void {
    const updatedClients = clients.map((c) => {
      if (c.id !== payment.clientId) return c;
      return {
        ...c,
        balance: roundMoney(c.balance + payment.appliedToRent),
        savings: roundMoney(Math.max(0, c.savings - payment.centavosAhorro)),
        installmentsRemaining: c.installmentsRemaining + payment.installmentsDeducted,
        installmentsPaid: Math.max(0, c.installmentsPaid - payment.installmentsDeducted)
      };
    });
    onClientsChange(updatedClients);
    onPaymentsChange(payments.filter((p) => p.id !== payment.id));
    setDeleteTarget(null);
  }

  function validateNotified(): string[] {
    const errs: string[] = [];
    const unit = notifiedForm.unitId.trim();
    if (!unit) errs.push("Debes indicar la unidad del pago notificado.");
    if (unit && !notifiedClientMatch) errs.push(`No existe un cliente activo con la unidad "${unit}".`);
    const amount = parseFloat(notifiedForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) errs.push("El monto notificado debe ser mayor a 0.");
    return errs;
  }

  function handleAddNotifiedPayment(): void {
    const errs = validateNotified();
    if (errs.length > 0) {
      setNotifiedErrors(errs);
      return;
    }
    setNotifiedErrors([]);
    if (!notifiedClientMatch) return;
    const next: NotifiedPayment = {
      id: crypto.randomUUID(),
      clientId: notifiedClientMatch.id,
      amount: roundMoney(parseFloat(notifiedForm.amount)),
      createdAt: new Date().toISOString()
    };
    const rows = [...notifiedPayments, next];
    setNotifiedPayments(rows);
    saveNotifiedPayments(rows);
    setNotifiedForm({
      unitId: "",
      amount: ""
    });
  }

  function handleDeleteNotifiedPayment(id: string): void {
    const rows = notifiedPayments.filter((r) => r.id !== id);
    setNotifiedPayments(rows);
    saveNotifiedPayments(rows);
  }

  function handleMoveNotifiedToRegister(row: NotifiedPayment): void {
    setForm((prev) => ({
      ...prev,
      clientId: row.clientId,
      dateApplied: toDateKey(new Date()),
      amountReceived: String(row.amount)
    }));
    handleDeleteNotifiedPayment(row.id);
  }

  const historyRows = useMemo(() => {
    const filtered = historyClientId === "all"
      ? payments
      : payments.filter((p) => p.clientId === historyClientId);
    return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  }, [payments, historyClientId]);

  if (confirmedPayment) {
    return (
      <div className="page-inner">
        <header className="hero">
          <h1>Modulo 2 — Pagos</h1>
          <p>Recibo generado correctamente.</p>
        </header>
        <PaymentReceipt payment={confirmedPayment} onClose={() => setConfirmedPayment(null)} />
      </div>
    );
  }

  return (
    <div className="page-inner">
      <header className="hero">
        <h1>Modulo 2 — Pagos</h1>
        <p>Registra abonos y descarga recibos en imagen.</p>
      </header>

      {/* ── Payment form ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>Registrar pago</h2>
          <button type="button" className="button ghost" onClick={() => setIsRegisterOpen((v) => !v)}>
            {isRegisterOpen ? "Cerrar" : "+ Registrar pago"}
          </button>
        </div>

        {isRegisterOpen && (
        <>
        {/* Client selector */}
        <div className="payment-form-grid" style={{ marginTop: 16 }}>
          <div className="payment-field-group" style={{ gridColumn: "1 / -1" }}>
            <label className="payment-label">Cliente</label>
            {selectedClient ? (
              <div className="client-selected-pill">
                <span><strong>{selectedClient.unitId}</strong> — {selectedClient.name}{selectedClient.cedula ? ` (${selectedClient.cedula})` : ""}</span>
                <button type="button" className="client-pill-clear" onClick={handleClearClient} title="Cambiar cliente">✕</button>
              </div>
            ) : (
              <div className="client-selector">
                <input
                  ref={searchRef}
                  type="text"
                  className="client-search-input"
                  placeholder="Buscar por unidad, nombre o cedula..."
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                  autoComplete="off"
                />
                {dropdownOpen && filteredClients.length > 0 && (
                  <div className="client-dropdown">
                    {filteredClients.map((c) => (
                      <div key={c.id} className="client-dropdown-item" onMouseDown={() => handleSelectClient(c)}>
                        <strong>{c.unitId}</strong> — {c.name}
                        {c.cedula && <span className="client-dropdown-cedula"> · {c.cedula}</span>}
                        <span className="client-dropdown-balance"> · {formatCurrency(c.balance)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {dropdownOpen && filteredClients.length === 0 && clientSearch.trim() && (
                  <div className="client-dropdown">
                    <div className="client-dropdown-empty">Sin resultados para "{clientSearch}"</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Date */}
          <div className="payment-field-group">
            <label className="payment-label">Fecha aplicada</label>
            <input
              type="date"
              className="payment-input"
              value={form.dateApplied}
              onChange={(e) => setForm((f) => ({ ...f, dateApplied: e.target.value }))}
            />
          </div>

          {/* Method */}
          <div className="payment-field-group">
            <label className="payment-label">Forma de pago</label>
            <select className="payment-input" value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as PaymentMethod }))}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="payment-field-group">
            <label className="payment-label">{isBankPayment ? "Referencia (Folio)" : "Referencia (Opcional)"}</label>
            <input
              type="text"
              className="payment-input"
              placeholder={isBankPayment ? "Obligatorio para pago bancario" : "Opcional"}
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
            {isBankPayment && <span className="payment-inline-hint">Para pagos bancarios debes colocar el folio o referencia.</span>}
          </div>

          {/* Amount */}
          <div className="payment-field-group">
            <label className="payment-label">Monto recibido (USD)</label>
            <input
              type="number"
              className="payment-input payment-input--amount"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={form.amountReceived}
              onChange={(e) => setForm((f) => ({ ...f, amountReceived: e.target.value }))}
            />
          </div>
        </div>

        {/* Zero balance notice */}
        {isZeroBalance && (
          <div className="payment-notice">
            Este cliente no tiene saldo pendiente. El monto completo se registrara como fondo de viaje.
          </div>
        )}

        {/* Preview */}
        {preview && selectedClient && (
          <div className="payment-preview">
            <div className="payment-preview-title">Vista previa del pago</div>
            <div className="payment-preview-body">
              <div className="payment-preview-col">
                <div className="payment-preview-row">
                  <span>Saldo actual</span>
                  <strong className="amount-debt">{formatCurrency(preview.balanceBefore)}</strong>
                </div>
                <div className="payment-preview-row">
                  <span>Aplicado a renta</span>
                  <strong>{formatCurrency(preview.appliedToRent)}</strong>
                </div>
                {preview.centavosAhorro > 0 && (
                  <div className="payment-preview-row">
                    <span>Fondo de viaje (ahorro)</span>
                    <strong>{formatCurrency(preview.centavosAhorro)}</strong>
                  </div>
                )}
              </div>
              <div className="payment-preview-col">
                <div className="payment-preview-row">
                  <span>Nuevo saldo</span>
                  <strong className={preview.balanceAfter <= 0 ? "amount-good" : "amount-debt"}>{formatCurrency(preview.balanceAfter)}</strong>
                </div>
                <div className="payment-preview-row">
                  <span>Cuotas deducidas</span>
                  <strong>{preview.installmentsDeducted}</strong>
                </div>
                <div className="payment-preview-row">
                  <span>Cuotas restantes</span>
                  <strong>{Math.max(0, selectedClient.installmentsRemaining - preview.installmentsDeducted)}</strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="error-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}

        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            className="button primary"
            onClick={handleConfirmPayment}
            disabled={!form.clientId || !preview}
          >
            Confirmar pago y generar recibo
          </button>
        </div>
        </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Pagos notificados (pendientes)</h2>
          <button type="button" className="button ghost" onClick={() => setIsNotifiedOpen((v) => !v)}>
            {isNotifiedOpen ? "Cerrar" : "+ Pago notificado"}
          </button>
        </div>

        {isNotifiedOpen && (
        <>
        <p className="hint">Ingresa la unidad y el monto. El sistema trae automaticamente el cliente.</p>

        <div className="payment-form-grid" style={{ marginTop: 12 }}>
          <div className="payment-field-group">
            <label className="payment-label">Unidad</label>
            <input
              type="text"
              className="payment-input"
              placeholder="Ej. T01"
              value={notifiedForm.unitId}
              onChange={(e) => setNotifiedForm((f) => ({ ...f, unitId: e.target.value }))}
            />
          </div>

          <div className="payment-field-group">
            <label className="payment-label">Monto notificado (USD)</label>
            <input
              type="number"
              className="payment-input payment-input--amount"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={notifiedForm.amount}
              onChange={(e) => setNotifiedForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
        </div>

        <div className="hint" style={{ marginTop: 6 }}>
          {notifiedForm.unitId.trim() === ""
            ? "Cliente detectado: -"
            : notifiedClientMatch
              ? `Cliente detectado: ${notifiedClientMatch.unitId} - ${notifiedClientMatch.name}`
              : "Cliente detectado: unidad no encontrada"}
        </div>

        {notifiedErrors.length > 0 && (
          <ul className="error-list">{notifiedErrors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}

        <div style={{ marginTop: 14 }}>
          <button type="button" className="button primary" onClick={handleAddNotifiedPayment}>
            Guardar pago notificado
          </button>
        </div>

        {notifiedRows.length === 0 ? (
          <p className="empty">No hay pagos notificados pendientes.</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>Unidad</th>
                  <th>Cliente</th>
                  <th>Monto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {notifiedRows.map((row) => {
                  const client = clients.find((c) => c.id === row.clientId);
                  return (
                    <tr key={row.id}>
                      <td>{client?.unitId ?? "-"}</td>
                      <td>{client?.name ?? "Cliente no encontrado"}</td>
                      <td><span className="amount-good">{formatCurrency(row.amount)}</span></td>
                      <td className="actions-cell">
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => handleMoveNotifiedToRegister(row)}
                        >
                          Pasar a registro
                        </button>
                        <button
                          type="button"
                          className="button danger small"
                          onClick={() => handleDeleteNotifiedPayment(row.id)}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </section>

      {/* ── Payment history ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>Historial de pagos</h2>
          <select
            value={historyClientId}
            onChange={(e) => setHistoryClientId(e.target.value)}
            className="history-filter-select"
          >
            <option value="all">Todos los clientes</option>
            {activeClients.map((c) => (
              <option key={c.id} value={c.id}>{c.unitId} — {c.name}</option>
            ))}
          </select>
        </div>

        {historyRows.length === 0 ? (
          <p className="empty">No hay pagos registrados aun.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Recibo</th>
                  <th>Fecha</th>
                  <th>Unidad</th>
                  <th>Cliente</th>
                  <th>Monto</th>
                  <th>A renta</th>
                  <th>Ahorro</th>
                  <th>Cuotas</th>
                  <th>Metodo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.receiptNumber}</strong></td>
                    <td>{formatDate(new Date(`${p.dateApplied}T12:00:00`))}</td>
                    <td>{p.clientUnit}</td>
                    <td>{p.clientName}</td>
                    <td><span className="amount-good">{formatCurrency(p.amountReceived)}</span></td>
                    <td>{formatCurrency(p.appliedToRent)}</td>
                    <td>{p.centavosAhorro > 0 ? formatCurrency(p.centavosAhorro) : <span className="amount-muted">-</span>}</td>
                    <td>{p.installmentsDeducted > 0 ? `-${p.installmentsDeducted}` : <span className="amount-muted">-</span>}</td>
                    <td>{p.paymentMethod}</td>
                    <td>
                      <button
                        type="button"
                        className="action-btn action-btn--edit"
                        title="Vista previa del recibo"
                        onClick={() => setHistoryPreviewPayment(p)}
                      >Ver</button>
                      <button
                        type="button"
                        className="action-btn action-btn--delete"
                        title="Eliminar pago"
                        onClick={() => setDeleteTarget(p)}
                      >X</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {historyRows.length > 0 && (
          <p className="hint">Mostrando los ultimos {historyRows.length} pagos.</p>
        )}
      </section>

      {historyPreviewPayment && (
        <div className="modal-overlay">
          <div className="modal payment-receipt-modal">
            <PaymentReceipt
              payment={historyPreviewPayment}
              onClose={() => setHistoryPreviewPayment(null)}
              closeLabel="Cerrar vista previa"
            />
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 className="modal-title">Eliminar pago</h3>
            <p className="modal-body">
              ¿Confirmas que deseas eliminar el recibo <strong>{deleteTarget.receiptNumber}</strong> de{" "}
              <strong>{deleteTarget.clientName}</strong> por{" "}
              <strong>{formatCurrency(deleteTarget.amountReceived)}</strong>?<br /><br />
              El saldo del cliente sera revertido automaticamente.
            </p>
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setDeleteTarget(null)}>Cancelar</button>
              <button type="button" className="button danger" onClick={() => handleDeletePayment(deleteTarget)}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

