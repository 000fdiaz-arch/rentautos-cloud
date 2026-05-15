import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { formatCurrency } from "../format";
import type { Client, Payment } from "../types";

type Movement = {
  id: string;
  detail: string;
  amount: number;
  reference?: string;
  actor?: string;
};

type DenominationRow = {
  id: string;
  value: number;
  qty: number;
};

type CashClosingPageProps = {
  clients: Client[];
  payments: Payment[];
  onStartCashClientPayment?: (payload: {
    dateApplied: string;
    clientId: string;
    reference: string;
    amountReceived: string;
  }) => void;
};

const COIN_VALUES = [0.01, 0.05, 0.1, 0.25, 0.5, 1];
const BILL_VALUES = [1, 5, 10, 20, 50, 100];

function createMovement(id: string): Movement {
  return { id, detail: "", amount: 0, reference: "", actor: "" };
}

function createDenominationRows(prefix: string, values: number[]): DenominationRow[] {
  return values.map((value) => ({ id: `${prefix}-${value}`, value, qty: 0 }));
}

export default function CashClosingPage({ clients, payments, onStartCashClientPayment }: CashClosingPageProps) {
  const [cashDate, setCashDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [openingCash, setOpeningCash] = useState<number>(2289.07);
  const [manualIncomeRows, setManualIncomeRows] = useState<Movement[]>([createMovement("mi-1")]);
  const [expenseRows, setExpenseRows] = useState<Movement[]>([
    { id: "e-1", detail: "Combustible B54", amount: 20, reference: "", actor: "" },
    { id: "e-2", detail: "Combustible A36", amount: 10, reference: "", actor: "" },
    createMovement("e-3")
  ]);
  const [coinRows, setCoinRows] = useState<DenominationRow[]>(createDenominationRows("c", COIN_VALUES));
  const [billRows, setBillRows] = useState<DenominationRow[]>(createDenominationRows("b", BILL_VALUES));
  const [showCashPaymentModal, setShowCashPaymentModal] = useState(false);
  const [modalClientId, setModalClientId] = useState("");
  const [modalReference, setModalReference] = useState("");
  const [modalAmount, setModalAmount] = useState("");
  const [modalError, setModalError] = useState("");

  const clientCashPayments = useMemo(
    () => payments.filter((payment) => payment.dateApplied === cashDate && payment.paymentMethod === "Efectivo"),
    [payments, cashDate]
  );
  const clientCashTotal = useMemo(
    () => clientCashPayments.reduce((sum, payment) => sum + payment.amountReceived, 0),
    [clientCashPayments]
  );
  const manualIncomeTotal = useMemo(
    () => manualIncomeRows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0),
    [manualIncomeRows]
  );
  const totalIncome = clientCashTotal + manualIncomeTotal;
  const totalExpense = useMemo(
    () => expenseRows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0),
    [expenseRows]
  );
  const expectedCash = openingCash + totalIncome - totalExpense;
  const realCash = useMemo(() => {
    const coins = coinRows.reduce((sum, row) => sum + row.value * row.qty, 0);
    const bills = billRows.reduce((sum, row) => sum + row.value * row.qty, 0);
    return coins + bills;
  }, [coinRows, billRows]);
  const diff = realCash - expectedCash;

  function updateMovement(
    rows: Movement[],
    setRows: Dispatch<SetStateAction<Movement[]>>,
    id: string,
    patch: Partial<Movement>
  ): void {
    setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function updateQty(
    rows: DenominationRow[],
    setRows: Dispatch<SetStateAction<DenominationRow[]>>,
    id: string,
    qty: number
  ): void {
    setRows(rows.map((row) => (row.id === id ? { ...row, qty } : row)));
  }

  function handleOpenCashPaymentModal(): void {
    setModalError("");
    setModalClientId("");
    setModalReference("");
    setModalAmount("");
    setShowCashPaymentModal(true);
  }

  function handleConfirmCashPaymentModal(): void {
    if (!modalClientId) {
      setModalError("Selecciona un cliente.");
      return;
    }
    const amountNumber = Number(modalAmount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setModalError("Ingresa un monto valido mayor que cero.");
      return;
    }
    onStartCashClientPayment?.({
      dateApplied: cashDate,
      clientId: modalClientId,
      reference: modalReference.trim(),
      amountReceived: modalAmount.trim()
    });
    setShowCashPaymentModal(false);
  }

  return (
    <section className="cash-page">
      <header className="hero">
        <h1>Cuadre de Caja (Cash)</h1>
        <p>Flujo inicial para validar formato diario de ingresos y egresos en efectivo.</p>
      </header>

      <section className="panel cash-panel">
        <div className="cash-header-grid">
          <label>
            Fecha operativa
            <input type="date" value={cashDate} onChange={(event) => setCashDate(event.target.value)} />
          </label>
          <label>
            Caja inicial
            <input
              type="number"
              value={openingCash}
              step="0.01"
              onChange={(event) => setOpeningCash(Number(event.target.value || 0))}
            />
          </label>
        </div>
      </section>

      <section className="panel cash-panel">
        <h2>Entradas de efectivo</h2>
        <div className="cash-actions-row">
          <button
            type="button"
            className="button primary"
            onClick={handleOpenCashPaymentModal}
          >
            Pago Cliente en efectivo
          </button>
        </div>

        <div className="cash-subpanel">
          <h3>1) Pago de cliente (automatico)</h3>
          {clientCashPayments.length === 0 && <p className="hint">No hay pagos en efectivo para esta fecha.</p>}
          {clientCashPayments.map((payment) => (
            <div key={payment.id} className="cash-readonly-row">
              <span>{payment.clientUnit} - {payment.clientName}</span>
              <span>Recibo {payment.receiptNumber}</span>
              <strong>{formatCurrency(payment.amountReceived)}</strong>
            </div>
          ))}
          <p className="cash-total">Total pagos cliente: <strong>{formatCurrency(clientCashTotal)}</strong></p>
        </div>

        <div className="cash-subpanel">
          <h3>2) Entrada manual</h3>
          {manualIncomeRows.map((row) => (
            <div key={row.id} className="cash-movement-row cash-movement-row--three">
              <input
                type="text"
                placeholder="Comentario"
                value={row.detail}
                onChange={(event) =>
                  updateMovement(manualIncomeRows, setManualIncomeRows, row.id, { detail: event.target.value })
                }
              />
              <input
                type="text"
                placeholder="Referencia"
                value={row.reference || ""}
                onChange={(event) =>
                  updateMovement(manualIncomeRows, setManualIncomeRows, row.id, { reference: event.target.value })
                }
              />
              <input
                type="number"
                step="0.01"
                value={row.amount || ""}
                onChange={(event) =>
                  updateMovement(manualIncomeRows, setManualIncomeRows, row.id, { amount: Number(event.target.value || 0) })
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="button ghost small"
            onClick={() => setManualIncomeRows((rows) => [...rows, createMovement(`mi-${rows.length + 1}`)])}
          >
            + Agregar entrada
          </button>
          <p className="cash-total">Total entradas manuales: <strong>{formatCurrency(manualIncomeTotal)}</strong></p>
        </div>

        <p className="cash-total cash-total--grand">Total entradas: <strong>{formatCurrency(totalIncome)}</strong></p>
      </section>

      <section className="panel cash-panel">
        <h2>Salidas de efectivo</h2>
        {expenseRows.map((row) => (
          <div key={row.id} className="cash-movement-row">
            <input
              type="text"
              placeholder="Detalle de gasto"
              value={row.detail}
              onChange={(event) => updateMovement(expenseRows, setExpenseRows, row.id, { detail: event.target.value })}
            />
            <input
              type="number"
              step="0.01"
              value={row.amount || ""}
              onChange={(event) =>
                updateMovement(expenseRows, setExpenseRows, row.id, { amount: Number(event.target.value || 0) })
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="button ghost small"
          onClick={() => setExpenseRows((rows) => [...rows, createMovement(`e-${rows.length + 1}`)])}
        >
          + Agregar salida
        </button>
        <p className="cash-total">Total salidas: <strong>{formatCurrency(totalExpense)}</strong></p>
      </section>

      <section className="panel cash-panel">
        <h2>Conteo fisico</h2>
        <div className="cash-denominations-grid">
          <div>
            <h3>Monedas</h3>
            {coinRows.map((row) => (
              <div key={row.id} className="cash-denomination-row">
                <span>{formatCurrency(row.value)}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={row.qty || ""}
                  onChange={(event) => updateQty(coinRows, setCoinRows, row.id, Number(event.target.value || 0))}
                />
                <strong>{formatCurrency(row.value * row.qty)}</strong>
              </div>
            ))}
          </div>
          <div>
            <h3>Billetes</h3>
            {billRows.map((row) => (
              <div key={row.id} className="cash-denomination-row">
                <span>{formatCurrency(row.value)}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={row.qty || ""}
                  onChange={(event) => updateQty(billRows, setBillRows, row.id, Number(event.target.value || 0))}
                />
                <strong>{formatCurrency(row.value * row.qty)}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel cash-panel cash-result">
        <h2>Resultado del cuadre</h2>
        <div className="cash-result-grid">
          <p>Caja esperada</p>
          <strong>{formatCurrency(expectedCash)}</strong>
          <p>Efectivo real</p>
          <strong>{formatCurrency(realCash)}</strong>
          <p>Diferencia</p>
          <strong className={diff === 0 ? "" : diff > 0 ? "amount-good" : "amount-debt"}>{formatCurrency(diff)}</strong>
        </div>
      </section>

      {showCashPaymentModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <section className="modal confirm-modal">
            <header className="modal-header">
              <h2>Pago Cliente en efectivo</h2>
              <button type="button" className="modal-close" onClick={() => setShowCashPaymentModal(false)}>
                X
              </button>
            </header>
            <div className="modal-body">
              <div className="form-grid">
                <label>
                  Cliente
                  <select value={modalClientId} onChange={(event) => setModalClientId(event.target.value)}>
                    <option value="">Selecciona cliente...</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.unitId} - {client.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Referencia
                  <input
                    type="text"
                    value={modalReference}
                    onChange={(event) => setModalReference(event.target.value)}
                    placeholder="Referencia opcional"
                  />
                </label>
                <label>
                  Monto
                  <input
                    type="number"
                    step="0.01"
                    value={modalAmount}
                    onChange={(event) => setModalAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
              </div>
              {modalError && <p className="error-text">{modalError}</p>}
              <div className="confirm-modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="button ghost" onClick={() => setShowCashPaymentModal(false)}>
                  Cancelar
                </button>
                <button type="button" className="button primary" onClick={handleConfirmCashPaymentModal}>
                  Ir a Registrar pago
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
