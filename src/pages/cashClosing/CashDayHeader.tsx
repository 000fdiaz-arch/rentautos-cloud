import { formatCurrency } from "../../format";
import { getCashClosingDateError } from "../../cashClosingRules";

export type CashViewTab = "operacion" | "conteo" | "reportes" | "auditoria";

type Props = {
  totals: { opening: number; income: number; expense: number; expected: number; real: number; difference: number };
  viewTab: CashViewTab;
  setViewTab: (tab: CashViewTab) => void;
  isAdmin: boolean;
  cashDate: string;
  setCashDate: (date: string) => void;
  loadingDay: boolean;
  syncMessage: string;
  isDayInitialized: boolean;
  isDayClosed: boolean;
  seedOpeningCash: string;
  setSeedOpeningCash: (value: string) => void;
  closingNote: string;
  setClosingNote: (value: string) => void;
  reopenNote: string;
  setReopenNote: (value: string) => void;
  onInitialize: () => void;
  onSave: () => void;
  onClose: () => void;
  onReopen: () => void;
};

export default function CashDayHeader({
  totals,
  viewTab,
  setViewTab,
  isAdmin,
  cashDate,
  setCashDate,
  loadingDay,
  syncMessage,
  isDayInitialized,
  isDayClosed,
  seedOpeningCash,
  setSeedOpeningCash,
  closingNote,
  setClosingNote,
  reopenNote,
  setReopenNote,
  onInitialize,
  onSave,
  onClose,
  onReopen
}: Props) {
  const closingDateError = getCashClosingDateError(cashDate);
  return (
    <>
      <section className="panel cash-kpi-sticky">
        <div className="cash-kpi-grid">
          <article><span>Inicial</span><strong>{formatCurrency(totals.opening)}</strong></article>
          <article><span>Ingresos</span><strong>{formatCurrency(totals.income)}</strong></article>
          <article><span>Egresos</span><strong>{formatCurrency(totals.expense)}</strong></article>
          <article><span>Esperado</span><strong>{formatCurrency(totals.expected)}</strong></article>
          <article><span>Real</span><strong>{formatCurrency(totals.real)}</strong></article>
          <article><span>Diferencia</span><strong className={totals.difference === 0 ? "" : totals.difference > 0 ? "amount-good" : "amount-debt"}>{formatCurrency(totals.difference)}</strong></article>
        </div>
      </section>

      <section className="panel cash-panel">
        <div className="cash-view-tabs">
          {(["operacion", "conteo", "reportes"] as const).map((tab) => (
            <button key={tab} type="button" className={`button ghost small ${viewTab === tab ? "cash-tab-active" : ""}`} onClick={() => setViewTab(tab)}>
              {tab === "operacion" ? "Operacion" : tab === "conteo" ? "Conteo" : "Reportes"}
            </button>
          ))}
          {isAdmin && <button type="button" className={`button ghost small ${viewTab === "auditoria" ? "cash-tab-active" : ""}`} onClick={() => setViewTab("auditoria")}>Auditoria</button>}
        </div>
      </section>

      <section className="panel cash-panel" hidden={viewTab !== "operacion"}>
        <div className="cash-header-grid">
          <label>Fecha operativa<input type="date" value={cashDate} onChange={(event) => setCashDate(event.target.value)} /></label>
          <label>Caja inicial<input type="number" value={totals.opening} step="0.01" readOnly /></label>
        </div>
        {loadingDay && <p className="hint">Cargando jornada...</p>}
        {syncMessage && <p className="hint">{syncMessage}</p>}
        {closingDateError && <p className="hint error-text" role="alert">{closingDateError}</p>}
        {!isDayInitialized && (
          <div className="cash-subpanel" style={{ marginTop: 10 }}>
            <h3>Apertura de jornada</h3>
            <p className="hint">Si no existe cierre previo, ingresa saldo inicial de arranque y abre la jornada.</p>
            <div className="cash-movement-row">
              <input type="number" step="0.01" placeholder="Saldo inicial de arranque" value={seedOpeningCash} onChange={(event) => setSeedOpeningCash(event.target.value)} />
              <button type="button" className="button primary" onClick={onInitialize} disabled={!isAdmin || loadingDay}>Abrir jornada</button>
            </div>
          </div>
        )}
        {isDayInitialized && (
          <div className="cash-subpanel" style={{ marginTop: 10 }}>
            <h3>Control de jornada</h3>
            <p className="hint">Estado: <strong className={isDayClosed ? "amount-debt" : "amount-good"}>{isDayClosed ? "CERRADA" : "ABIERTA"}</strong></p>
            {!isDayClosed ? (
              <div className="cash-movement-row cash-movement-row--three">
                <input type="text" placeholder="Nota de cierre (opcional)" value={closingNote} onChange={(event) => setClosingNote(event.target.value)} />
                <button type="button" className="button ghost" onClick={onSave} disabled={loadingDay}>Guardar cambios</button>
                <button type="button" className="button primary" onClick={onClose} disabled={!isAdmin || loadingDay || Boolean(closingDateError)}>Cerrar caja del dia</button>
              </div>
            ) : (
              <div className="cash-movement-row cash-movement-row--three">
                <input type="text" placeholder="Motivo de reapertura" value={reopenNote} onChange={(event) => setReopenNote(event.target.value)} />
                <span />
                <button type="button" className="button ghost" onClick={onReopen} disabled={!isAdmin || loadingDay}>Reabrir caja</button>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
