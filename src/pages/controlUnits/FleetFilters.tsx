import { memo } from "react";
import { statusLabel } from "./controlUnitsRules";

type Props = {
  search: string;
  groupFilter: string;
  modelFilter: string;
  companyFilter: string;
  statusFilter: string;
  groups: string[];
  models: string[];
  companies: string[];
  statuses: string[];
  onSearchChange: (value: string) => void;
  onGroupFilterChange: (value: string) => void;
  onModelFilterChange: (value: string) => void;
  onCompanyFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
};

export const FleetFilters = memo(function FleetFilters({
  search,
  groupFilter,
  modelFilter,
  companyFilter,
  statusFilter,
  groups,
  models,
  companies,
  statuses,
  onSearchChange,
  onGroupFilterChange,
  onModelFilterChange,
  onCompanyFilterChange,
  onStatusFilterChange
}: Props) {
  return (
    <div className="filters-bar fleet-filters-bar">
      <input
        type="text"
        value={search}
        placeholder="Buscar por unidad, placa, serial, modelo..."
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <select value={groupFilter} onChange={(event) => onGroupFilterChange(event.target.value)}>
        <option value="all">Grupo (todos)</option>
        {groups.map((group) => <option key={group} value={group}>{group}</option>)}
      </select>
      <select value={modelFilter} onChange={(event) => onModelFilterChange(event.target.value)}>
        <option value="all">Modelo (todos)</option>
        {models.map((model) => <option key={model} value={model}>{model}</option>)}
      </select>
      <select value={companyFilter} onChange={(event) => onCompanyFilterChange(event.target.value)}>
        <option value="all">Empresa (todas)</option>
        {companies.map((company) => <option key={company} value={company}>{company}</option>)}
      </select>
      <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
        <option value="all">Estado (todos)</option>
        {statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
      </select>
    </div>
  );
});
