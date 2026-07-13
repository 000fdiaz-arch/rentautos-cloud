import { formatCurrency } from "../../format";
type SummaryRow = {
  opening_date: string;
  opening_balance: number;
  income_total: number;
  expense_total: number;
  expected_balance: number;
  difference_balance: number | null;
  status: "open" | "closed";
};

type AuditRow = { id: number; created_at: string; table_name: string; action: string };

type ReportMode = "day" | "week" | "month";

type Props = {
  showReports: boolean;
  showAudit: boolean;
  isAdmin: boolean;
  reportMode: ReportMode;
  setReportMode: (mode: ReportMode) => void;
  reportRows: SummaryRow[];
  topDifferenceRows: SummaryRow[];
  auditRows: AuditRow[];
  reportTotals: { opening: number; income: number; expense: number; expected: number };
  onPreview: () => void;
  onExportJpg: () => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
};

export default function CashReportsPanels({
  showReports,
  showAudit,
  isAdmin,
  reportMode,
  setReportMode,
  reportRows,
  topDifferenceRows,
  auditRows,
  reportTotals,
  onPreview,
  onExportJpg,
  onExportPdf,
  onExportExcel
}: Props) {
  return (
    <>
      <section className="panel cash-panel" hidden={!showReports}>
        <div className="panel-head">
          <h2>Reporte ejecutivo</h2>
          <button type="button" className="button ghost small" onClick={onPreview}>Vista previa</button>
        </div>
        <p className="hint">Usa "Vista previa" para abrir el reporte y revisar antes de exportar.</p>
        <div className="cash-actions-row" style={{ marginTop: 12 }}>
          <button type="button" className="button ghost small" onClick={onExportJpg}>Exportar JPG</button>
          <button type="button" className="button ghost small" onClick={onExportPdf}>Exportar PDF</button>
          <button type="button" className="button ghost small" onClick={onExportExcel}>Exportar Excel</button>
        </div>
      </section>

      <section className="panel cash-panel" hidden={!showReports}>
        <h2>Reportes</h2>
        <div className="cash-actions-row">
          {(["day", "week", "month"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`button ghost small ${reportMode === mode ? "nav-tab--active" : ""}`}
              onClick={() => setReportMode(mode)}
            >
              {mode === "day" ? "Dia" : mode === "week" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
        <div className="cash-subpanel">
          <p className="cash-total">
            Totales periodo: Inicial <strong>{formatCurrency(reportTotals.opening)}</strong> | Ingresos{" "}
            <strong>{formatCurrency(reportTotals.income)}</strong> | Egresos <strong>{formatCurrency(reportTotals.expense)}</strong> | Esperado{" "}
            <strong>{formatCurrency(reportTotals.expected)}</strong>
          </p>
          {reportRows.length === 0 ? (
            <p className="hint">No hay datos para el periodo seleccionado.</p>
          ) : (
            <SummaryTable rows={reportRows} />
          )}
          {(reportMode === "week" || reportMode === "month") && topDifferenceRows.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Top diferencias del periodo</h3>
              <div className="table-scroll">
                <table className="ar-table ar-table--compact">
                  <thead><tr><th>Fecha</th><th>Diferencia</th><th>Estado</th></tr></thead>
                  <tbody>
                    {topDifferenceRows.map((row) => (
                      <tr key={`diff-${row.opening_date}`}>
                        <td>{row.opening_date}</td>
                        <td>{formatCurrency(row.difference_balance ?? 0)}</td>
                        <td>{row.status === "closed" ? "Cerrada" : "Abierta"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>

      {isAdmin && (
        <section className="panel cash-panel" hidden={!showAudit}>
          <h2>Auditoria del dia</h2>
          <div className="cash-subpanel">
            {auditRows.length === 0 ? <p className="hint">Sin eventos de auditoria para esta fecha.</p> : (
              <div className="table-scroll">
                <table className="ar-table ar-table--compact">
                  <thead><tr><th>Fecha/Hora</th><th>Tabla</th><th>Accion</th></tr></thead>
                  <tbody>
                    {auditRows.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.created_at).toLocaleString("es-PA")}</td>
                        <td>{row.table_name}</td>
                        <td>{row.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  return (
    <div className="table-scroll">
      <table className="ar-table ar-table--compact">
        <thead>
          <tr><th>Fecha</th><th>Inicial</th><th>Ingresos</th><th>Egresos</th><th>Esperado</th><th>Diferencia</th><th>Estado</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.opening_date}>
              <td>{row.opening_date}</td>
              <td>{formatCurrency(row.opening_balance)}</td>
              <td>{formatCurrency(row.income_total)}</td>
              <td>{formatCurrency(row.expense_total)}</td>
              <td>{formatCurrency(row.expected_balance)}</td>
              <td>{formatCurrency(row.difference_balance ?? 0)}</td>
              <td>{row.status === "closed" ? "Cerrada" : "Abierta"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
