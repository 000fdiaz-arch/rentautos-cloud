export type PaymentTabId =
  | "register"
  | "notified"
  | "pending"
  | "cards"
  | "income"
  | "history"
  | "cash";

type Props = {
  activeTab: PaymentTabId;
  onSelect: (tab: PaymentTabId) => void;
  onImportCsv: () => void;
  readOnly?: boolean;
};

const TABS: Array<{ id: PaymentTabId; label: string }> = [
  { id: "register", label: "Registrar pago" },
  { id: "notified", label: "Pago notificado" },
  { id: "pending", label: "Ver pendientes" },
  { id: "cards", label: "Pendientes tarjeta" },
  { id: "income", label: "Ingresos del día" },
  { id: "history", label: "Historial pagos" },
  { id: "cash", label: "Cierre de caja" }
];

export default function PaymentsTabs({ activeTab, onSelect, onImportCsv, readOnly = false }: Props) {
  const visibleTabs = readOnly ? TABS.filter((tab) => tab.id === "income" || tab.id === "history") : TABS;
  return (
    <section className="panel payment-tabs-panel" aria-label="Navegación de pagos">
      <div className="payment-tabs-row">
        <div className="payment-tabs" role="tablist" aria-label="Opciones de pagos">
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`payment-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`payment-panel-${tab.id}`}
                className={`payment-tab${isActive ? " payment-tab--active" : ""}`}
                onClick={() => onSelect(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {!readOnly && (
          <button type="button" className="button ghost small payment-import-button" onClick={onImportCsv}>
            Importar CSV
          </button>
        )}
      </div>
    </section>
  );
}
