import type { ReceivableFilters, ReceivableState } from "../../receivables";
import { STATE_FILTER_OPTIONS } from "./receivablesPageRules";

type Props = {
  filters: ReceivableFilters;
  onFilterChange: <K extends keyof ReceivableFilters>(key: K, value: ReceivableFilters[K]) => void;
  onStateFilterToggle: (value: ReceivableState | "all") => void;
  onClearFilters: () => void;
};

export function ReceivablesFiltersPanel({
  filters,
  onFilterChange,
  onStateFilterToggle,
  onClearFilters
}: Props) {
  return (
    <section className="panel ar-filters-panel">
      <div className="ar-filters-head">
        <div>
          <h2>Filtros</h2>
          <span className="hint">Refina la cartera visible</span>
        </div>
        <button type="button" className="button ghost small" onClick={onClearFilters}>Limpiar</button>
      </div>
      <div className="ar-filters-grid">
        <label className="ar-filter-field">
          <span className="ar-filter-label">Unidad</span>
          <input
            type="text"
            placeholder="Ej. T35"
            value={filters.unitSearch}
            onChange={(event) => onFilterChange("unitSearch", event.target.value)}
          />
        </label>
        <label className="ar-filter-field">
          <span className="ar-filter-label">Cliente</span>
          <input
            type="text"
            placeholder="Nombre"
            value={filters.clientSearch}
            onChange={(event) => onFilterChange("clientSearch", event.target.value)}
          />
        </label>
        <label className="ar-filter-field">
          <span className="ar-filter-label">Cedula</span>
          <input
            type="text"
            placeholder="Documento"
            value={filters.cedulaSearch}
            onChange={(event) => onFilterChange("cedulaSearch", event.target.value)}
          />
        </label>
        <label className="ar-filter-field">
          <span className="ar-filter-label">Plan</span>
          <select
            value={filters.plan}
            onChange={(event) => onFilterChange("plan", event.target.value as ReceivableFilters["plan"])}
          >
            <option value="all">Todos</option>
            <option value="daily">Diario</option>
            <option value="weekly">Semanal</option>
            <option value="biweekly">Quincenal</option>
            <option value="monthly">Mensual</option>
          </select>
        </label>
        <div className="ar-filter-field ar-filter-field--states">
          <span className="ar-filter-label">Estado</span>
          <div className="ar-state-chips" role="group" aria-label="Filtro de estado">
            <button
              type="button"
              className={`ar-state-chip ${filters.state.length === 0 ? "ar-state-chip--active" : ""}`}
              onClick={() => onStateFilterToggle("all")}
            >
              Todos
            </button>
            {STATE_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`ar-state-chip ${filters.state.includes(option.value) ? "ar-state-chip--active" : ""}`}
                onClick={() => onStateFilterToggle(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
