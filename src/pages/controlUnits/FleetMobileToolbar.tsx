import { memo } from "react";

type Props = {
  visibleCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
};

export const FleetMobileToolbar = memo(function FleetMobileToolbar({
  visibleCount,
  totalCount,
  hasActiveFilters,
  onClearFilters
}: Props) {
  return (
    <div className="fleet-mobile-toolbar">
      <span>{visibleCount} de {totalCount} autos</span>
      {hasActiveFilters && (
        <button type="button" className="button ghost small" onClick={onClearFilters}>
          Limpiar filtros
        </button>
      )}
    </div>
  );
});
