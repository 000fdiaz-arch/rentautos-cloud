export type PaymentTabId =
  | "register"
  | "notified"
  | "pending"
  | "cards"
  | "history"
  | "cash";

type Props = {
  activeTab: PaymentTabId;
  onSelect: (tab: PaymentTabId) => void;
  onImportCsv: () => void;
};

const TABS: Array<{ id: PaymentTabId; label: string }> = [
  { id: "register", label: "Registrar pago" },
  { id: "notified", label: "Pago notificado" },
  { id: "pending", label: "Pendientes banco" },
  { id: "cards", label: "Pendientes tarjeta" },
  { id: "history", label: "Historial pagos" },
  { id: "cash", label: "Cierre de caja" }
];

export default function PaymentsTabs({ activeTab, onSelect, onImportCsv }: Props) {
  return (
    <section className="panel payment-tabs-panel" aria-label="Navegación de pagos">
      <div className="payment-tabs-row">
        <div className="payment-tabs" role="tablist" aria-label="Opciones de pagos">
          {TABS.map((tab) => {
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
        <button type="button" className="button ghost small payment-import-button" onClick={onImportCsv}>
          Importar CSV
        </button>
      </div>
    </section>
  );
}
