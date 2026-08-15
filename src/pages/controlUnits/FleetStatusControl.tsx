import { memo } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { effectiveStatus, statusBadgeClass, statusLabel } from "./controlUnitsRules";

type Props = {
  row: ControlUnitRow;
  readOnly: boolean;
  canEditStatus: boolean;
  onOpenStatusDialog: (row: ControlUnitRow) => void;
};

export const FleetStatusControl = memo(function FleetStatusControl({
  row,
  readOnly,
  canEditStatus,
  onOpenStatusDialog
}: Props) {
  const status = effectiveStatus(row);
  if (readOnly || !canEditStatus || status === "provisional_rental") {
    return <span className={statusBadgeClass(status)}>{statusLabel(status)}</span>;
  }
  return (
    <button
      type="button"
      className={statusBadgeClass(status)}
      onClick={() => onOpenStatusDialog(row)}
      title="Cambiar estado de la unidad"
    >
      {statusLabel(status)}
    </button>
  );
});
