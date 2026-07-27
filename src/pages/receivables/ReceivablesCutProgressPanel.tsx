import { memo } from "react";
import type { CollectionStatus, WhatsAppContactFilter } from "./receivablesTypes";
import {
  COLLECTION_STATUS_HELP,
  DAILY_COLLECTION_STATUS_OPTIONS,
  type CollectionCutKey
} from "./receivablesPageRules";

type CutProgressItem = {
  key: CollectionCutKey;
  label: string;
  managed: number;
  total: number;
  pending: number;
  percent: number;
  statusCounts: Record<CollectionStatus, number>;
};

type Props = {
  whatsAppContactFilter: WhatsAppContactFilter;
  whatsAppContactCounts: Record<WhatsAppContactFilter, number>;
  collectionCutProgress: CutProgressItem[];
  onWhatsAppContactFilterChange: (value: WhatsAppContactFilter) => void;
};

export const ReceivablesCutProgressPanel = memo(function ReceivablesCutProgressPanel({
  whatsAppContactFilter,
  whatsAppContactCounts,
  collectionCutProgress,
  onWhatsAppContactFilterChange
}: Props) {
  return (
    <div className="ar-cut-progress-panel" aria-label="Avance de gestion por corte">
      <div className="ar-cut-view-toggle ar-whatsapp-view-toggle" aria-label="Filtrar por estado de WhatsApp">
        <span>WhatsApp</span>
        {([
          ["all", "Todos"],
          ["missing", "Sin numero"],
          ["ready", "Por enviar"],
          ["opened", "Pendientes"],
          ["sent", "Completados"]
        ] as Array<[WhatsAppContactFilter, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={whatsAppContactFilter === value ? "is-active" : ""}
            onClick={() => onWhatsAppContactFilterChange(value)}
          >
            {label} <strong>{whatsAppContactCounts[value]}</strong>
          </button>
        ))}
      </div>
      {collectionCutProgress.map((cut) => (
        <article key={cut.key} className={`ar-cut-progress-card ar-cut-progress-card--${cut.key}`}>
          <div className="ar-cut-progress-head">
            <span className="ar-cut-progress-label">{cut.label}</span>
            <strong>{cut.managed}/{cut.total}</strong>
          </div>
          <div className="ar-cut-progress-track" aria-hidden="true">
            <span style={{ width: `${cut.percent}%` }} />
          </div>
          <div className="ar-cut-progress-meta">
            <span>{cut.percent}% gestionado</span>
            <span>{cut.pending} faltan</span>
          </div>
          <div className="ar-cut-progress-breakdown">
            {DAILY_COLLECTION_STATUS_OPTIONS.filter((option) => cut.statusCounts[option.value] > 0).map((option) => (
              <span
                key={option.value}
                className={`ar-cut-progress-pill ar-cut-progress-pill--${option.value}`}
                title={COLLECTION_STATUS_HELP[option.value]}
              >
                {cut.statusCounts[option.value]} {option.label.replace(/\.$/, "")}
              </span>
            ))}
            {cut.managed === 0 ? <span className="ar-cut-progress-empty">Sin gestiones</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
});
