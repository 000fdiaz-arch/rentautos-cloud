import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { BUSINESS_TIME_ZONE, getBusinessDateKey } from "../billing";
import { formatCurrency } from "../format";
import type { Client, Payment } from "../types";
import PaymentReceipt from "../components/PaymentReceipt";
import {
  closeCashDay,
  loadCashAudit,
  loadCashCounts,
  loadCashMovements,
  loadCashSummary,
  loadCashSummaryRange,
  openCashDay,
  reopenCashDay,
  replaceCashCounts,
  replaceCashMovements
} from "../cashLedger";
import { isSupabaseConfigured } from "../lib/supabase";
import CashReportsPanels from "./cashClosing/CashReportsPanels";
import CashDayHeader from "./cashClosing/CashDayHeader";

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
  appRole?: "admin" | "operador" | "lectura";
  dataOwnerUserId?: string | null;
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

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function CashClosingPage({
  clients,
  payments,
  appRole = "lectura",
  dataOwnerUserId,
  onStartCashClientPayment
}: CashClosingPageProps) {
  const executiveReportRef = useRef<HTMLDivElement | null>(null);
  const whatsappReportRef = useRef<HTMLDivElement | null>(null);
  const [cashDate, setCashDate] = useState<string>(getBusinessDateKey());
  const [openingCash, setOpeningCash] = useState<number>(0);
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
  const [showExecutivePreview, setShowExecutivePreview] = useState(false);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<Payment | null>(null);
  const [seedOpeningCash, setSeedOpeningCash] = useState<string>("");
  const [closingNote, setClosingNote] = useState<string>("");
  const [reopenNote, setReopenNote] = useState<string>("");
  const [isDayInitialized, setIsDayInitialized] = useState<boolean>(false);
  const [isDayClosed, setIsDayClosed] = useState<boolean>(false);
  const [loadingDay, setLoadingDay] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [viewTab, setViewTab] = useState<"operacion" | "conteo" | "reportes" | "auditoria">("operacion");
  const [reportMode, setReportMode] = useState<"day" | "week" | "month">("day");
  const [reportRows, setReportRows] = useState<Array<{
    opening_date: string;
    opening_balance: number;
    income_total: number;
    expense_total: number;
    expected_balance: number;
    difference_balance: number | null;
    status: "open" | "closed";
  }>>([]);
  const [auditRows, setAuditRows] = useState<Array<{
    id: number;
    opening_date: string | null;
    table_name: string;
    action: string;
    created_at: string;
  }>>([]);
  const isAdmin = appRole === "admin";
  const isEditingLocked = isDayClosed;

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
  const exportDateSuffix = cashDate || getBusinessDateKey();
  const generatedAt = new Date().toLocaleString("es-PA", { timeZone: BUSINESS_TIME_ZONE });
  const topManualIncomes = manualIncomeRows.filter((row) => row.amount > 0).slice(0, 8);
  const topExpenses = expenseRows.filter((row) => row.amount > 0).slice(0, 8);
  const whatsappIncomeDetails = topManualIncomes;
  const whatsappExpenseDetails = topExpenses;
  const topCoinRows = coinRows.filter((row) => row.qty > 0);
  const topBillRows = billRows.filter((row) => row.qty > 0);
  const topDifferenceRows = useMemo(
    () =>
      reportRows
        .filter((row) => typeof row.difference_balance === "number" && row.difference_balance !== 0)
        .sort((a, b) => Math.abs(Number(b.difference_balance || 0)) - Math.abs(Number(a.difference_balance || 0)))
        .slice(0, 5),
    [reportRows]
  );
  const reportTotals = useMemo(
    () => reportRows.reduce(
      (acc, row) => {
        acc.opening += Number(row.opening_balance || 0);
        acc.income += Number(row.income_total || 0);
        acc.expense += Number(row.expense_total || 0);
        acc.expected += Number(row.expected_balance || 0);
        return acc;
      },
      { opening: 0, income: 0, expense: 0, expected: 0 }
    ),
    [reportRows]
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    (async () => {
      try {
        const toKey = cashDate;
        const fromKey = reportMode === "week"
          ? addDaysToDateKey(cashDate, -6)
          : reportMode === "month"
            ? addDaysToDateKey(cashDate, -29)
            : cashDate;
        const rows = await loadCashSummaryRange(fromKey, toKey, dataOwnerUserId);
        if (!active) return;
        setReportRows(rows);
      } catch {
        if (!active) return;
        setReportRows([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [cashDate, reportMode, dataOwnerUserId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !isAdmin) return;
    let active = true;
    (async () => {
      try {
        const rows = await loadCashAudit(cashDate, dataOwnerUserId);
        if (!active) return;
        setAuditRows(rows.map((row) => ({
          id: row.id,
          opening_date: row.opening_date,
          table_name: row.table_name,
          action: row.action,
          created_at: row.created_at
        })));
      } catch {
        if (!active) return;
        setAuditRows([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [cashDate, dataOwnerUserId, isAdmin, syncMessage]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSyncMessage("Supabase no configurado. Esta pantalla requiere conexion en nube.");
      return;
    }
    let active = true;
    setLoadingDay(true);
    setSyncMessage("");
    (async () => {
      try {
        const [summary, movements, counts] = await Promise.all([
          loadCashSummary(cashDate, dataOwnerUserId),
          loadCashMovements(cashDate, dataOwnerUserId),
          loadCashCounts(cashDate, dataOwnerUserId)
        ]);
        if (!active) return;
        if (!summary) {
          setIsDayInitialized(false);
          setIsDayClosed(false);
          setOpeningCash(0);
          setManualIncomeRows([createMovement("mi-1")]);
          setExpenseRows([createMovement("e-1")]);
          setCoinRows(createDenominationRows("c", COIN_VALUES));
          setBillRows(createDenominationRows("b", BILL_VALUES));
          return;
        }
        setIsDayInitialized(true);
        setIsDayClosed(summary.status === "closed");
        setOpeningCash(Number(summary.opening_balance || 0));
        const incomeRows = movements
          .filter((row) => row.movement_type === "income")
          .map((row, index) => ({
            id: row.id || `mi-${index + 1}`,
            detail: row.description || "",
            amount: Number(row.amount || 0),
            reference: row.reference || "",
            actor: ""
          }));
        const expenseRowsLoaded = movements
          .filter((row) => row.movement_type === "expense")
          .map((row, index) => ({
            id: row.id || `e-${index + 1}`,
            detail: row.description || "",
            amount: Number(row.amount || 0),
            reference: row.reference || "",
            actor: ""
          }));
        setManualIncomeRows(incomeRows.length > 0 ? incomeRows : [createMovement("mi-1")]);
        setExpenseRows(expenseRowsLoaded.length > 0 ? expenseRowsLoaded : [createMovement("e-1")]);
        const coinMap = new Map<number, number>();
        const billMap = new Map<number, number>();
        counts.forEach((row) => {
          if (row.denomination_type === "coin") coinMap.set(Number(row.denomination_value), Number(row.qty || 0));
          if (row.denomination_type === "bill") billMap.set(Number(row.denomination_value), Number(row.qty || 0));
        });
        setCoinRows(createDenominationRows("c", COIN_VALUES).map((row) => ({ ...row, qty: coinMap.get(row.value) ?? 0 })));
        setBillRows(createDenominationRows("b", BILL_VALUES).map((row) => ({ ...row, qty: billMap.get(row.value) ?? 0 })));
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "No se pudo cargar la jornada de caja.";
        setSyncMessage(message);
      } finally {
        if (active) setLoadingDay(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [cashDate, dataOwnerUserId]);

  async function handleInitializeDay(): Promise<void> {
    if (!isAdmin) {
      setSyncMessage("Solo admin puede abrir caja.");
      return;
    }
    const seedRaw = seedOpeningCash.trim();
    const hasManualSeed = seedRaw.length > 0;
    const seed = hasManualSeed ? Number(seedRaw) : null;
    if (hasManualSeed && (!Number.isFinite(seed) || (seed ?? 0) < 0)) {
      setSyncMessage("Ingresa un saldo inicial valido (>= 0).");
      return;
    }
    try {
      setLoadingDay(true);
      setSyncMessage("");
      await openCashDay(
        cashDate,
        seed,
        hasManualSeed ? "Apertura manual de arranque" : "Apertura automatica por arrastre de cierre anterior"
      );
      setSeedOpeningCash("");
      const [summary, counts] = await Promise.all([
        loadCashSummary(cashDate, dataOwnerUserId),
        loadCashCounts(cashDate, dataOwnerUserId)
      ]);
      setIsDayInitialized(!!summary);
      setIsDayClosed(summary?.status === "closed");
      setOpeningCash(Number(summary?.opening_balance ?? 0));
      const coinMap = new Map<number, number>();
      const billMap = new Map<number, number>();
      counts.forEach((row) => {
        if (row.denomination_type === "coin") coinMap.set(Number(row.denomination_value), Number(row.qty || 0));
        if (row.denomination_type === "bill") billMap.set(Number(row.denomination_value), Number(row.qty || 0));
      });
      setCoinRows(createDenominationRows("c", COIN_VALUES).map((row) => ({ ...row, qty: coinMap.get(row.value) ?? 0 })));
      setBillRows(createDenominationRows("b", BILL_VALUES).map((row) => ({ ...row, qty: billMap.get(row.value) ?? 0 })));
      setSyncMessage("Jornada abierta correctamente.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo abrir la jornada.";
      setSyncMessage(message);
    } finally {
      setLoadingDay(false);
    }
  }

  async function handleSaveMovements(showMessage = true): Promise<void> {
    if (!isDayInitialized) {
      setSyncMessage("Primero debes abrir la jornada de caja.");
      return;
    }
    try {
      setLoadingDay(true);
      setSyncMessage("");
      const payload = [
        ...manualIncomeRows
          .filter((row) => row.amount > 0)
          .map((row) => ({
            movement_type: "income" as const,
            category: "manual_income",
            amount: row.amount,
            description: row.detail,
            reference: row.reference
          })),
        ...expenseRows
          .filter((row) => row.amount > 0)
          .map((row) => ({
            movement_type: "expense" as const,
            category: "manual_expense",
            amount: row.amount,
            description: row.detail,
            reference: row.reference
          }))
      ];
      await replaceCashMovements(cashDate, payload, dataOwnerUserId);
      await replaceCashCounts(
        cashDate,
        [
          ...coinRows.map((row) => ({ denomination_type: "coin" as const, denomination_value: row.value, qty: row.qty })),
          ...billRows.map((row) => ({ denomination_type: "bill" as const, denomination_value: row.value, qty: row.qty }))
        ],
        dataOwnerUserId
      );
      if (showMessage) setSyncMessage("Movimientos guardados.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar movimientos.";
      setSyncMessage(message);
    } finally {
      setLoadingDay(false);
    }
  }

  async function handleCloseDay(): Promise<void> {
    if (!isAdmin) {
      setSyncMessage("Solo admin puede cerrar caja.");
      return;
    }
    try {
      setLoadingDay(true);
      setSyncMessage("");
      await handleSaveMovements(false);
      await closeCashDay(cashDate, realCash, closingNote.trim() || undefined);
      setIsDayClosed(true);
      setClosingNote("");
      setSyncMessage("Caja cerrada correctamente.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cerrar caja.";
      setSyncMessage(message);
    } finally {
      setLoadingDay(false);
    }
  }

  async function handleReopenDay(): Promise<void> {
    if (!isAdmin) {
      setSyncMessage("Solo admin puede reabrir caja.");
      return;
    }
    if (!reopenNote.trim()) {
      setSyncMessage("Debes indicar motivo de reapertura.");
      return;
    }
    try {
      setLoadingDay(true);
      setSyncMessage("");
      await reopenCashDay(cashDate, reopenNote.trim());
      setIsDayClosed(false);
      setReopenNote("");
      setSyncMessage("Caja reabierta.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo reabrir caja.";
      setSyncMessage(message);
    } finally {
      setLoadingDay(false);
    }
  }

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

  async function handleExportJpg(): Promise<void> {
    if (!whatsappReportRef.current) return;
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(whatsappReportRef.current, {
      backgroundColor: "#ffffff",
      scale: 2
    });
    const url = canvas.toDataURL("image/jpeg", 0.95);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cuadre-caja-${exportDateSuffix}.jpg`;
    anchor.click();
  }

  async function handleExportPdf(): Promise<void> {
    if (!executiveReportRef.current) return;
    const [{ default: html2canvas }, { default: JsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf")
    ]);
    const canvas = await html2canvas(executiveReportRef.current, {
      backgroundColor: "#ffffff",
      scale: 2
    });
    const image = canvas.toDataURL("image/png");
    const pdf = new JsPDF("p", "mm", "a4");
    const pageWidth = 210;
    const margin = 10;
    const usableWidth = pageWidth - margin * 2;
    const imageHeight = (canvas.height * usableWidth) / canvas.width;
    pdf.addImage(image, "PNG", margin, margin, usableWidth, imageHeight);
    pdf.save(`cuadre-caja-${exportDateSuffix}.pdf`);
  }

  async function handleExportExcel(): Promise<void> {
    const { utils, writeFile } = await import("xlsx");
    const book = utils.book_new();
    const rows: (string | number)[][] = [
      ["Cuadre de Caja", cashDate],
      [],
      ["Caja inicial", openingCash],
      ["Total entradas", totalIncome],
      ["Total salidas", totalExpense],
      ["Caja esperada", expectedCash],
      ["Efectivo real", realCash],
      ["Diferencia", diff],
      [],
      ["Pagos cliente (automatico)"],
      ["Cliente", "Recibo", "Monto"]
    ];

    if (clientCashPayments.length === 0) {
      rows.push(["Sin pagos en efectivo", "", ""]);
    } else {
      clientCashPayments.forEach((payment) => {
        rows.push([`${payment.clientUnit} - ${payment.clientName}`, payment.receiptNumber, payment.amountReceived]);
      });
    }

    rows.push([]);
    rows.push(["Entradas manuales"]);
    rows.push(["Comentario", "Referencia", "Monto"]);
    manualIncomeRows.forEach((row) => {
      rows.push([row.detail || "", row.reference || "", Number.isFinite(row.amount) ? row.amount : 0]);
    });

    rows.push([]);
    rows.push(["Salidas de efectivo"]);
    rows.push(["Detalle", "Monto"]);
    expenseRows.forEach((row) => {
      rows.push([row.detail || "", Number.isFinite(row.amount) ? row.amount : 0]);
    });

    rows.push([]);
    rows.push(["Conteo de monedas y billetes"]);
    rows.push(["Tipo", "Denominacion", "Cantidad", "Total"]);
    coinRows.forEach((row) => {
      rows.push(["Moneda", row.value, row.qty, row.value * row.qty]);
    });
    billRows.forEach((row) => {
      rows.push(["Billete", row.value, row.qty, row.value * row.qty]);
    });

    const sheet = utils.aoa_to_sheet(rows);
    utils.book_append_sheet(book, sheet, "Cuadre Caja");
    writeFile(book, `cuadre-caja-${exportDateSuffix}.xlsx`);
  }

  return (
    <section className="cash-page">
      <header className="hero">
        <h1>Cuadre de Caja (Cash)</h1>
        <p>Flujo inicial para validar formato diario de ingresos y egresos en efectivo.</p>
      </header>

      <CashDayHeader
        totals={{
          opening: openingCash,
          income: totalIncome,
          expense: totalExpense,
          expected: expectedCash,
          real: realCash,
          difference: diff
        }}
        viewTab={viewTab}
        setViewTab={setViewTab}
        isAdmin={isAdmin}
        cashDate={cashDate}
        setCashDate={setCashDate}
        loadingDay={loadingDay}
        syncMessage={syncMessage}
        isDayInitialized={isDayInitialized}
        isDayClosed={isDayClosed}
        seedOpeningCash={seedOpeningCash}
        setSeedOpeningCash={setSeedOpeningCash}
        closingNote={closingNote}
        setClosingNote={setClosingNote}
        reopenNote={reopenNote}
        setReopenNote={setReopenNote}
        onInitialize={() => void handleInitializeDay()}
        onSave={() => void handleSaveMovements()}
        onClose={() => void handleCloseDay()}
        onReopen={() => void handleReopenDay()}
      />

      <CashReportsPanels
        showReports={viewTab === "reportes"}
        showAudit={viewTab === "auditoria"}
        isAdmin={isAdmin}
        reportMode={reportMode}
        setReportMode={setReportMode}
        reportRows={reportRows}
        topDifferenceRows={topDifferenceRows}
        auditRows={auditRows}
        reportTotals={reportTotals}
        onPreview={() => setShowExecutivePreview(true)}
        onExportJpg={() => void handleExportJpg()}
        onExportPdf={() => void handleExportPdf()}
        onExportExcel={() => void handleExportExcel()}
      />

      <div>
      <section className="panel cash-panel" hidden={viewTab !== "operacion"}>
        <h2>Entradas de efectivo</h2>
        <div className="cash-actions-row">
          <button
                  type="button"
                  className="button primary"
                  onClick={handleOpenCashPaymentModal}
                  disabled={isEditingLocked}
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
                disabled={isEditingLocked}
                onChange={(event) =>
                  updateMovement(manualIncomeRows, setManualIncomeRows, row.id, { detail: event.target.value })
                }
              />
              <input
                type="text"
                placeholder="Referencia"
                value={row.reference || ""}
                disabled={isEditingLocked}
                onChange={(event) =>
                  updateMovement(manualIncomeRows, setManualIncomeRows, row.id, { reference: event.target.value })
                }
              />
              <input
                type="number"
                step="0.01"
                value={row.amount || ""}
                disabled={isEditingLocked}
                onChange={(event) =>
                  updateMovement(manualIncomeRows, setManualIncomeRows, row.id, { amount: Number(event.target.value || 0) })
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="button ghost small"
            disabled={isEditingLocked}
            onClick={() => setManualIncomeRows((rows) => [...rows, createMovement(`mi-${rows.length + 1}`)])}
          >
            + Agregar entrada
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void handleSaveMovements()}
            disabled={loadingDay || !isDayInitialized || isEditingLocked}
            style={{ marginLeft: 8 }}
          >
            Guardar entradas
          </button>
          <p className="cash-total">Total entradas manuales: <strong>{formatCurrency(manualIncomeTotal)}</strong></p>
        </div>

        <p className="cash-total cash-total--grand">Total entradas: <strong>{formatCurrency(totalIncome)}</strong></p>
      </section>

      <section className="panel cash-panel" hidden={viewTab !== "operacion"}>
        <h2>Salidas de efectivo</h2>
        <div className="cash-actions-row" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="button ghost"
            onClick={() => void handleSaveMovements()}
            disabled={loadingDay || !isDayInitialized || isEditingLocked}
          >
            Guardar salidas
          </button>
        </div>
        {expenseRows.map((row) => (
          <div key={row.id} className="cash-movement-row">
            <input
              type="text"
              placeholder="Detalle de gasto"
              value={row.detail}
              disabled={isEditingLocked}
              onChange={(event) => updateMovement(expenseRows, setExpenseRows, row.id, { detail: event.target.value })}
            />
            <input
              type="number"
              step="0.01"
              value={row.amount || ""}
              disabled={isEditingLocked}
              onChange={(event) =>
                updateMovement(expenseRows, setExpenseRows, row.id, { amount: Number(event.target.value || 0) })
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="button ghost small"
          disabled={isEditingLocked}
          onClick={() => setExpenseRows((rows) => [...rows, createMovement(`e-${rows.length + 1}`)])}
        >
          + Agregar salida
        </button>
        <p className="cash-total">Total salidas: <strong>{formatCurrency(totalExpense)}</strong></p>
      </section>

      <section className="panel cash-panel" hidden={viewTab !== "conteo"}>
        <h2>Conteo fisico</h2>
        <div className="cash-actions-row" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void handleSaveMovements()}
            disabled={loadingDay || !isDayInitialized || isEditingLocked}
          >
            Guardar conteo
          </button>
        </div>
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
                  disabled={isEditingLocked}
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
                  disabled={isEditingLocked}
                  onChange={(event) => updateQty(billRows, setBillRows, row.id, Number(event.target.value || 0))}
                />
                <strong>{formatCurrency(row.value * row.qty)}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      </div>

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

      {selectedReceiptPayment && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <section className="modal payment-receipt-modal">
            <PaymentReceipt
              payment={selectedReceiptPayment}
              onClose={() => setSelectedReceiptPayment(null)}
              closeLabel="Cerrar detalle"
            />
          </section>
        </div>
      )}

      {showExecutivePreview && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <section className="modal" style={{ maxWidth: "1080px" }}>
            <header className="modal-header">
              <h2>Vista previa del reporte ejecutivo</h2>
              <button type="button" className="modal-close" onClick={() => setShowExecutivePreview(false)}>
                X
              </button>
            </header>
            <div className="modal-body">
              <h3 style={{ marginTop: 0 }}>Formato WhatsApp (JPG)</h3>
              <div className="cash-whatsapp-report">
                <p className="cash-whatsapp-brand">REPORTE DIARIO DE CAJA</p>
                <h4>Rentautos Cloud</h4>
                <p className="cash-whatsapp-date">Fecha: {cashDate}</p>
                <div className="cash-whatsapp-main">
                  <p>Cierre del dia</p>
                  <strong className={diff === 0 ? "" : diff > 0 ? "amount-good" : "amount-debt"}>{formatCurrency(diff)}</strong>
                </div>
                <div className="cash-whatsapp-kpis">
                  <article><span>Caja inicial</span><strong>{formatCurrency(openingCash)}</strong></article>
                  <article><span>Entradas</span><strong>{formatCurrency(totalIncome)}</strong></article>
                  <article><span>Salidas</span><strong>{formatCurrency(totalExpense)}</strong></article>
                  <article><span>Efectivo real</span><strong>{formatCurrency(realCash)}</strong></article>
                </div>
              </div>
              <h3 style={{ marginTop: 16 }}>Reporte ejecutivo</h3>
              <div className="cash-executive-report">
                <header className="cash-exec-header">
                  <div>
                    <p className="cash-exec-tag">REPORTE EJECUTIVO</p>
                    <h3>Cuadre de Caja Diario</h3>
                    <p>Fecha operativa: {cashDate}</p>
                  </div>
                  <div className="cash-exec-meta">
                    <p>Rentautos Cloud</p>
                    <p>Generado: {generatedAt}</p>
                  </div>
                </header>
                <section className="cash-exec-kpis">
                  <article><p>Caja inicial</p><strong>{formatCurrency(openingCash)}</strong></article>
                  <article><p>Entradas totales</p><strong>{formatCurrency(totalIncome)}</strong></article>
                  <article><p>Salidas totales</p><strong>{formatCurrency(totalExpense)}</strong></article>
                  <article><p>Diferencia</p><strong className={diff === 0 ? "" : diff > 0 ? "amount-good" : "amount-debt"}>{formatCurrency(diff)}</strong></article>
                </section>
              </div>
            </div>
          </section>
        </div>
      )}

      <div
        style={{
          position: "fixed",
          left: "-10000px",
          top: "0",
          width: "980px",
          opacity: 1,
          pointerEvents: "none",
          zIndex: -1
        }}
        aria-hidden="true"
      >
        <div className="cash-whatsapp-report" ref={whatsappReportRef}>
          <p className="cash-whatsapp-brand">REPORTE DIARIO DE CAJA</p>
          <h4>Rentautos Cloud</h4>
          <p className="cash-whatsapp-date">Fecha: {cashDate}</p>
          <div className="cash-whatsapp-main">
            <p>Cierre del dia</p>
            <strong className={diff === 0 ? "" : diff > 0 ? "amount-good" : "amount-debt"}>{formatCurrency(diff)}</strong>
          </div>
          <div className="cash-whatsapp-kpis">
            <article><span>Caja inicial</span><strong>{formatCurrency(openingCash)}</strong></article>
            <article><span>Entradas</span><strong>{formatCurrency(totalIncome)}</strong></article>
            <article><span>Salidas</span><strong>{formatCurrency(totalExpense)}</strong></article>
            <article><span>Efectivo real</span><strong>{formatCurrency(realCash)}</strong></article>
          </div>
          <div className="cash-whatsapp-details">
            <article>
              <h5>Detalle ingresos</h5>
              <p className="cash-whatsapp-detail-total">Total ingresos: {formatCurrency(totalIncome)}</p>
              <ul>
                <li>Pagos cliente: {formatCurrency(clientCashTotal)}</li>
                {clientCashPayments.map((payment) => (
                  <li key={`hidden-wp-pay-${payment.id}`}>{payment.clientUnit || "Unidad"}: {formatCurrency(payment.amountReceived)}</li>
                ))}
                {manualIncomeTotal > 0 && <li>Entradas manuales: {formatCurrency(manualIncomeTotal)}</li>}
                {whatsappIncomeDetails.map((row) => (
                  <li key={`hidden-wp-mi-${row.id}`}>{row.detail || "Entrada manual"}: {formatCurrency(row.amount || 0)}</li>
                ))}
              </ul>
            </article>
            <article>
              <h5>Detalle egresos</h5>
              <p className="cash-whatsapp-detail-total">Total egresos: {formatCurrency(totalExpense)}</p>
              {whatsappExpenseDetails.length === 0 ? (
                <ul><li>Sin egresos registrados.</li></ul>
              ) : (
                <ul>
                  {whatsappExpenseDetails.map((row) => (
                    <li key={`hidden-wp-eg-${row.id}`}>{row.detail || "Egreso"}: {formatCurrency(row.amount || 0)}</li>
                  ))}
                </ul>
              )}
            </article>
          </div>
          <div className="cash-whatsapp-foot">
            <p>Generado: {generatedAt}</p>
            <p>Pagos en efectivo: {clientCashPayments.length}</p>
          </div>
        </div>

        <div className="cash-executive-report" ref={executiveReportRef} style={{ marginTop: 16 }}>
          <header className="cash-exec-header">
            <div>
              <p className="cash-exec-tag">REPORTE EJECUTIVO</p>
              <h3>Cuadre de Caja Diario</h3>
              <p>Fecha operativa: {cashDate}</p>
            </div>
            <div className="cash-exec-meta">
              <p>Rentautos Cloud</p>
              <p>Generado: {generatedAt}</p>
            </div>
          </header>
          <section className="cash-exec-kpis">
            <article><p>Caja inicial</p><strong>{formatCurrency(openingCash)}</strong></article>
            <article><p>Entradas totales</p><strong>{formatCurrency(totalIncome)}</strong></article>
            <article><p>Salidas totales</p><strong>{formatCurrency(totalExpense)}</strong></article>
            <article><p>Diferencia</p><strong className={diff === 0 ? "" : diff > 0 ? "amount-good" : "amount-debt"}>{formatCurrency(diff)}</strong></article>
          </section>
        </div>
      </div>
    </section>
  );
}
