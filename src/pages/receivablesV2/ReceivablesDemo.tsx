import { useRef, useState, type ComponentProps } from "react";
import { ReceivablesLedgerTable } from "./ReceivablesLedgerTable";
import { createMockReceivableRows } from "../../receivablesV2";
import type { CollectionStatusRecord } from "./receivablesTypes";
import type { Payment } from "../../types";

export function ReceivablesDemo({ onClose }: { onClose: () => void }) {
  const [collector, setCollector] = useState("collector-1");
  const [minute, setMinute] = useState(839);
  const [paid, setPaid] = useState(0);
  const date = "2026-11-16";
  const now = new Date(date + "T" + String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0") + ":00-05:00");
  const scroll = useRef<HTMLDivElement>(null);
  const [records, setRecords] = useState<Record<string, CollectionStatusRecord>>({});
  const rows = [0, 1].map(index => ({
    ...createMockReceivableRows(now)[0], id: "demo-" + collector + "-" + index,
    unitId: (collector === "collector-1" ? "A" : "B") + "-PRUEBA-" + (index + 1),
    name: index === 0 ? "CLIENTE DE DEMOSTRACIÓN" : "GESTIÓN ACTUAL DE PRUEBA",
    totalPending: 100, overdueBalance: 100, daysLate: 1, rentAmount: 100,
    totalOtherCharges: 0, recentPayments: [], hasActiveClient: true
  }));
  const id = rows[0].id;
  const initial: CollectionStatusRecord = {
    status: "pending", comment: "", updatedAt: date + "T17:00:00Z",
    paymentPromiseDate: date, paymentPromiseTime: "14:00", paymentPromiseAmount: 100,
    contactOutcomes: [{ date, at: date + "T17:00:00Z", collector, result: "promise",
      promiseDate: date, promiseTime: "14:00", promiseAmount: 100 }]
  };
  const allRecords = { [id]: initial, ...records };
  function update(clientId: string, patch: Partial<CollectionStatusRecord>) {
    setRecords(current => ({ ...current, [clientId]: {
      ...(allRecords[clientId] ?? { status: "pending" as const, comment: "", updatedAt: now.toISOString() }), ...patch
    } }));
  }
  const noop = () => {};
  const props: ComponentProps<typeof ReceivablesLedgerTable> = {
    tableScrollRef: scroll, viewMode: "cartera", selectedHistoryDate: date, selectedHistoryRows: [],
    rows, collectionStatusByClient: allRecords, dailyContactCloudAttemptsByClient: {},
    dailyContactSaveStatesByClient: {}, clientStatusById: new Map(), tenureByClient: new Map(rows.map(row => [row.id, { label: "2 años", days: 730 }])),
    todayDateKey: date, now, isTodayCollectionClosed: false, workflowTab: "management",
    todayCollectionCuts: {}, visibleCollectionCut: "all", buildWhatsAppReceivableMessage: () => "",
    getWhatsAppGroupRows: () => undefined, getStatementGroupRows: () => undefined,
    onSelectDetail: noop, onCollectionCutStatusChange: noop, onCollectionCutCommentChange: noop,
    onRouteTagChange: () => false, onRouteManagementTypeChange: noop, onRouteManagementCommentChange: noop,
    onRouteAssignmentChange: noop, onRouteUrgencyChange: noop, onRouteReleaseAmountChange: noop,
    onRemoveFromRoute: noop, onWhatsAppMessageSent: noop, onSupportNoteChange: noop, onContactTimeChange: noop,
    onPaymentPromiseDateChange: (clientId, value) => update(clientId, { paymentPromiseDate: value }),
    onPaymentPromiseTimeChange: (clientId, value) => update(clientId, { paymentPromiseTime: value }),
    onPaymentPromiseAmountChange: (clientId, value) => update(clientId, { paymentPromiseAmount: Number(value) }),
    onGpsLocationReview: async () => {}, onPersistPendingChanges: noop, onDailyContactAttemptChange: noop,
    onOperationalReviewChange: noop, onOpenRoutePreparation: noop, onOpenRoute: noop, onClearFilters: noop,
    collectorKey: collector,
    payments: paid ? [{ id: "demo-payment", clientId: id, createdAt: date + "T18:00:00Z", amountReceived: paid } as Payment] : [],
    onContactOutcome: async (clientId, result) => {
      const record = allRecords[clientId];
      update(clientId, { contactOutcomes: [...(record?.contactOutcomes ?? []), {
        date, at: now.toISOString(), collector, result,
        promiseDate: record?.paymentPromiseDate || date,
        promiseTime: record?.paymentPromiseTime || "14:00",
        promiseAmount: record?.paymentPromiseAmount || 100
      }] });
    }
  };
  return <section>
    <div className="ar-followup-summary">
      <h3>Demostración · Datos ficticios · Sin guardado en la base de datos</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <label>Cobrador <select value={collector} onChange={e => { setCollector(e.target.value); setPaid(0); }}>
          <option value="collector-1">Cobrador 1</option><option value="collector-2">Cobrador 2</option>
        </select></label>
        <label>Hora de Panamá <select value={minute} onChange={e => setMinute(Number(e.target.value))}>
          <option value={839}>1:59 p. m.</option><option value={840}>2:00 p. m.</option><option value={900}>3:00 p. m.</option>
        </select></label>
        <label>Total abonado <select value={paid} onChange={e => setPaid(Number(e.target.value))}>
          <option value={0}>$0 · Sin pago</option><option value={40}>$40 · Parcial</option><option value={100}>$100 · Completo</option>
        </select></label>
        <button type="button" className="button" onClick={onClose}>Salir de la demostración</button>
      </div>
      <p>La primera unidad prometió $100 a las 2:00 p. m. Cambia la hora y el abono para probar la alerta. En la segunda unidad puedes guardar “No contestó” y finalizar el recorrido para probar la segunda vuelta.</p>
    </div>
    <ReceivablesLedgerTable {...props} />
  </section>;
}
