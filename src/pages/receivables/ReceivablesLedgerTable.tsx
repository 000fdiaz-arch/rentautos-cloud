import { memo, useState, type RefObject } from "react";
import { formatCurrency, formatDate } from "../../format";
import { STATE_LABEL, type ReceivableRow, type ReceivableState } from "../../receivables";
import type { Client } from "../../types";
import { fieldManagementLabel, type CollectionStatusRecord, type FieldManagementType } from "./receivablesTypes";
import { ReceivableTableRow } from "./ReceivableTableRow";
import {
  COLLECTION_CUT_OPTIONS,
  COLLECTION_STATUS_HELP,
  COLLECTION_STATUS_OPTIONS,
  ROUTE_ASSIGNMENT_OPTIONS,
  ROUTE_URGENCY_OPTIONS,
  normalizeRouteAssignment,
  overdueInstallmentsText,
  stateToneClass,
  type CollectionClosureItem,
  type CollectionCutKey,
  type ReceivablesViewMode,
  type ReceivablesWorkflowTab
} from "./receivablesPageRules";

export type ReceivablesHistoryRow = {
  clientId: string;
  unitId: string;
  clientName: string;
  lastPaymentDate: string | null;
  lastPaymentAt?: string | null;
  receivableState: string;
  totalPending: number;
  cuts: Partial<Record<CollectionCutKey, CollectionClosureItem>>;
};

type Props = {
  tableScrollRef: RefObject<HTMLDivElement>;
  viewMode: ReceivablesViewMode;
  selectedHistoryDate: string;
  selectedHistoryRows: ReceivablesHistoryRow[];
  rows: ReceivableRow[];
  collectionStatusByClient: Record<string, CollectionStatusRecord>;
  clientStatusById: Map<string, Client["status"]>;
  todayDateKey: string;
  now: Date;
  isTodayCollectionClosed: boolean;
  workflowTab: ReceivablesWorkflowTab;
  todayCollectionCuts: Partial<Record<CollectionCutKey, { items: CollectionClosureItem[] }>>;
  visibleCollectionCut: CollectionCutKey | "all";
  buildWhatsAppReceivableMessage: (row: ReceivableRow) => string;
  getWhatsAppGroupRows: (row: ReceivableRow) => ReceivableRow[];
  getStatementGroupRows: (row: ReceivableRow) => ReceivableRow[];
  onSelectDetail: (row: ReceivableRow) => void;
  onCollectionCutStatusChange: (cutKey: CollectionCutKey, clientId: string, nextStatus: string) => void;
  onCollectionCutCommentChange: (cutKey: CollectionCutKey, clientId: string, value: string) => void;
  onRouteTagChange: (clientId: string, tagged: boolean) => void;
  onRouteManagementTypeChange: (clientId: string, value: FieldManagementType) => void;
  onRouteManagementCommentChange: (clientId: string, value: string) => void;
  onRouteAssignmentChange: (clientId: string, value: string) => void;
  onRouteUrgencyChange: (clientId: string, value: "normal" | "urgent" | "very_urgent") => void;
  onRouteReleaseAmountChange: (clientId: string, value: string) => void;
  onRemoveFromRoute: (clientId: string) => void;
  onWhatsAppMessageSent: (clientId: string, message: string) => void;
  onSupportNoteChange: (clientId: string, value: string) => void;
  onContactTimeChange: (clientId: string, value: string) => void;
  onClearFilters: () => void;
};

function getCutItemsForClient(
  cuts: Partial<Record<CollectionCutKey, { items: CollectionClosureItem[] }>>,
  clientId: string
): Partial<Record<CollectionCutKey, CollectionClosureItem>> {
  const cutItems: Partial<Record<CollectionCutKey, CollectionClosureItem>> = {};
  for (const option of COLLECTION_CUT_OPTIONS) {
    const item = cuts[option.key]?.items.find((cutItem) => cutItem.clientId === clientId);
    if (item) cutItems[option.key] = item;
  }
  return cutItems;
}

function renderCutStatusCell(item: CollectionClosureItem | undefined) {
  if (!item) return <span className="ar-cut-empty">Sin corte</span>;
  const label = COLLECTION_STATUS_OPTIONS.find((option) => option.value === item.collectionStatus)?.label ?? "Sin estado";
  return (
    <div className="ar-cut-cell-content">
      <span
        className={`ar-cut-status ar-cut-status--${item.collectionStatus}`}
        title={COLLECTION_STATUS_HELP[item.collectionStatus]}
      >
        {label}
      </span>
      {item.comment ? <span className="hint ar-cut-comment">Comentario: {item.comment}</span> : null}
      <div className="ar-cut-actions">
        {item.whatsAppMessageSentAt ? <span>Enviado</span> : item.whatsAppMessageCopiedAt ? <span>Por enviar</span> : null}
        {item.managementAmount ? (
          <span>
            {fieldManagementLabel(item.managementType)} en ruta {formatCurrency(item.managementAmount)}
          </span>
        ) : null}
        {item.contactTime ? <span>Contactar {item.contactTime}</span> : null}
        {item.managementComment ? <span>{item.managementComment}</span> : null}
      </div>
    </div>
  );
}

function renderHistoryCutStack(item: CollectionClosureItem | undefined, cutKey: CollectionCutKey) {
  const cutOption = COLLECTION_CUT_OPTIONS.find((option) => option.key === cutKey);
  return (
    <div className={`ar-cut-stack-row ar-cut-stack-row--${cutKey}`}>
      <span className="ar-cut-stack-label">
        {cutOption?.shortLabel ?? "Gestion"}
      </span>
      {renderCutStatusCell(item)}
    </div>
  );
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

export const ReceivablesLedgerTable = memo(function ReceivablesLedgerTable({
  tableScrollRef,
  viewMode,
  selectedHistoryDate,
  selectedHistoryRows,
  rows,
  collectionStatusByClient,
  clientStatusById,
  todayDateKey,
  now,
  isTodayCollectionClosed,
  workflowTab,
  todayCollectionCuts,
  visibleCollectionCut,
  buildWhatsAppReceivableMessage,
  getWhatsAppGroupRows,
  getStatementGroupRows,
  onSelectDetail,
  onCollectionCutStatusChange,
  onCollectionCutCommentChange,
  onRouteTagChange,
  onRouteManagementTypeChange,
  onRouteManagementCommentChange,
  onRouteAssignmentChange,
  onRouteUrgencyChange,
  onRouteReleaseAmountChange,
  onRemoveFromRoute,
  onWhatsAppMessageSent,
  onSupportNoteChange,
  onContactTimeChange,
  onClearFilters
}: Props) {
  const [customRouteEditorByClient, setCustomRouteEditorByClient] = useState<Record<string, boolean>>({});
  const [routeAmountDraftByClient, setRouteAmountDraftByClient] = useState<Record<string, string>>({});

  function updateRouteAmountDraft(clientId: string, value: string): void {
    setRouteAmountDraftByClient((current) => ({
      ...current,
      [clientId]: value
    }));
  }

  function commitRouteAmountDraft(clientId: string): void {
    const draft = routeAmountDraftByClient[clientId];
    if (draft === undefined) return;
    setRouteAmountDraftByClient((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    onRouteReleaseAmountChange(clientId, draft);
  }

  if (viewMode === "cartera" && rows.length === 0) {
    return (
      <div className="table-scroll ar-ledger-scroll" ref={tableScrollRef}>
        <div className="ar-empty-results">
          <strong>No hay clientes para esos filtros</strong>
          <span>Prueba con otro estado o limpia los filtros para volver a ver la cartera.</span>
          <button type="button" className="button ghost small" onClick={onClearFilters}>
            Limpiar filtros
          </button>
        </div>
      </div>
    );
  }

  if (viewMode === "cartera" && workflowTab === "route") {
    return (
      <div className="table-scroll ar-ledger-scroll" ref={tableScrollRef}>
        <table className="ar-table ar-route-list-table">
          <thead>
            <tr>
              <th>Unidad</th>
              <th>Cliente</th>
              <th>Atraso</th>
              <th>Ult. pago</th>
              <th>Renta vencida</th>
              <th>Tipo</th>
              <th>Min. liberar</th>
              <th>Comentario</th>
              <th>Ruta</th>
              <th>Alarma</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const statusRecord = collectionStatusByClient[row.id];
              const routeReleaseAmount = statusRecord?.routeReleaseAmount ?? statusRecord?.managementAmount;
              const routeAssignment = statusRecord?.routeAssignment ?? "";
              const routeUrgency = statusRecord?.routeUrgency ?? "normal";
              const isCustomRouteAssignment = !!routeAssignment && !ROUTE_ASSIGNMENT_OPTIONS.includes(routeAssignment);
              const isCustomRouteEditorOpen = isCustomRouteAssignment || !!customRouteEditorByClient[row.id];
              return (
                <tr key={row.id} className={routeUrgency !== "normal" ? `ar-route-urgency-row ar-route-urgency-row--${routeUrgency}` : undefined}>
                  <td><strong className="ar-unit-id">{row.unitId}</strong></td>
                  <td>
                    <span className="client-name ar-route-client-name" title={row.name}>{firstName(row.name)}</span>
                  </td>
                  <td>{row.daysLate > 0 ? `${row.daysLate} dias` : "Sin atraso"}</td>
                  <td>
                    <div className="ar-account-status-stack">
                      <span className="ar-last-payment-date">
                        {row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "Sin pagos"}
                      </span>
                    </div>
                  </td>
                  <td className="amount-debt">
                    <strong className="ar-overdue-chip-amount">{formatCurrency(row.overdueBalance)}</strong>
                    <small className="ar-overdue-chip-installments">{overdueInstallmentsText(row.overdueBalance, row.rentAmount)}</small>
                  </td>
                  <td>
                    <select
                      className="ar-route-list-type"
                      value={statusRecord?.managementType ?? "solo_cobrar"}
                      onChange={(event) => onRouteManagementTypeChange(row.id, event.target.value as FieldManagementType)}
                      disabled={isTodayCollectionClosed}
                    >
                      <option value="solo_cobrar">Solo cobrar</option>
                      <option value="cobrar_o_quitar">Cobrar o quitar</option>
                      <option value="desiste">Desiste</option>
                      <option value="quitar">Quitar</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="ar-route-list-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={routeAmountDraftByClient[row.id] ?? (routeReleaseAmount ?? "")}
                      onChange={(event) => updateRouteAmountDraft(row.id, event.target.value)}
                      onBlur={() => commitRouteAmountDraft(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      placeholder={row.overdueBalance > 0 ? row.overdueBalance.toFixed(2) : "0.00"}
                      disabled={isTodayCollectionClosed}
                    />
                  </td>
                  <td>
                    <input
                      className="ar-route-list-comment"
                      type="text"
                      value={statusRecord?.managementComment ?? ""}
                      onChange={(event) => onRouteManagementCommentChange(row.id, event.target.value)}
                      placeholder="Comentario..."
                      maxLength={25}
                      disabled={isTodayCollectionClosed}
                    />
                  </td>
                  <td>
                    <div className="ar-route-assignment-cell">
                      {isCustomRouteEditorOpen ? (
                        <input
                          className="ar-route-list-route-custom"
                          type="text"
                          value={routeAssignment}
                          onChange={(event) => onRouteAssignmentChange(row.id, event.target.value)}
                          onBlur={(event) => {
                            const normalized = normalizeRouteAssignment(event.target.value);
                            if (event.target.value !== (normalized ?? "")) onRouteAssignmentChange(row.id, normalized ?? "");
                            if (!normalized) setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: false }));
                          }}
                          autoFocus
                          placeholder="Escribe ruta"
                          maxLength={12}
                          disabled={isTodayCollectionClosed}
                          aria-label={`Ruta manual de ${row.unitId}`}
                        />
                      ) : (
                        <select
                          className="ar-route-list-route"
                          value={routeAssignment}
                          onChange={(event) => {
                            const selected = event.target.value;
                            if (selected === "__custom") {
                              setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: true }));
                              onRouteAssignmentChange(row.id, "");
                              return;
                            }
                            setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: false }));
                            onRouteAssignmentChange(row.id, selected);
                          }}
                          disabled={isTodayCollectionClosed}
                          aria-label={`Ruta de ${row.unitId}`}
                        >
                          <option value="">Sin ruta</option>
                          {ROUTE_ASSIGNMENT_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                          <option value="__custom">Otra</option>
                        </select>
                      )}
                    </div>
                  </td>
                  <td>
                    <select
                      className={`ar-route-urgency-select ar-route-urgency-select--${routeUrgency}`}
                      value={routeUrgency}
                      onChange={(event) => onRouteUrgencyChange(row.id, event.target.value as "normal" | "urgent" | "very_urgent")}
                      disabled={isTodayCollectionClosed}
                    >
                      {ROUTE_URGENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button ghost small ar-route-list-remove"
                      onClick={() => onRemoveFromRoute(row.id)}
                      disabled={isTodayCollectionClosed}
                    >
                      Sacar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="ar-route-mobile-list" aria-label="Cobro en ruta">
          {rows.map((row) => {
            const statusRecord = collectionStatusByClient[row.id];
            const routeReleaseAmount = statusRecord?.routeReleaseAmount ?? statusRecord?.managementAmount;
            const routeAssignment = statusRecord?.routeAssignment ?? "";
            const routeUrgency = statusRecord?.routeUrgency ?? "normal";
            const isCustomRouteAssignment = !!routeAssignment && !ROUTE_ASSIGNMENT_OPTIONS.includes(routeAssignment);
            const isCustomRouteEditorOpen = isCustomRouteAssignment || !!customRouteEditorByClient[row.id];
            return (
              <article className={`ar-route-mobile-card ${routeUrgency !== "normal" ? `ar-route-mobile-card--${routeUrgency}` : ""}`} key={`mobile-route-${row.id}`}>
                <div className="ar-route-mobile-head">
                  <div className="ar-route-mobile-unit">
                    <strong className="ar-unit-id">{row.unitId}</strong>
                    <span title={row.name}>{firstName(row.name)}</span>
                  </div>
                  <div className="ar-route-mobile-amount">
                    <small>Renta vencida</small>
                    <strong className="ar-overdue-chip-amount">{formatCurrency(row.overdueBalance)}</strong>
                    <small className="ar-overdue-chip-installments">{overdueInstallmentsText(row.overdueBalance, row.rentAmount)}</small>
                  </div>
                </div>
                {routeUrgency !== "normal" ? (
                  <div className={`ar-route-alarm ar-route-alarm--${routeUrgency}`}>
                    {routeUrgency === "very_urgent" ? "Muy urgente" : "Urgente"}
                  </div>
                ) : null}

                <div className="ar-route-mobile-meta">
                  <span>{row.daysLate > 0 ? `${row.daysLate} dias de atraso` : "Sin atraso"}</span>
                  <span>{row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "Sin pagos"}</span>
                </div>

                <div className="ar-route-mobile-controls">
                  <label>
                    <span>Estado</span>
                    <span className="ar-cut-select ar-cut-select--pending ar-route-status-fixed">Pendiente · En ruta</span>
                  </label>
                  <label>
                    <span>Tipo</span>
                    <select
                      className="ar-route-list-type"
                      value={statusRecord?.managementType ?? "solo_cobrar"}
                      onChange={(event) => onRouteManagementTypeChange(row.id, event.target.value as FieldManagementType)}
                      disabled={isTodayCollectionClosed}
                    >
                      <option value="solo_cobrar">Solo cobrar</option>
                      <option value="cobrar_o_quitar">Cobrar o quitar</option>
                      <option value="desiste">Desiste</option>
                      <option value="quitar">Quitar</option>
                    </select>
                  </label>
                  <label>
                    <span>Min. liberar</span>
                    <input
                      className="ar-route-list-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={routeAmountDraftByClient[row.id] ?? (routeReleaseAmount ?? "")}
                      onChange={(event) => updateRouteAmountDraft(row.id, event.target.value)}
                      onBlur={() => commitRouteAmountDraft(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      placeholder={row.overdueBalance > 0 ? row.overdueBalance.toFixed(2) : "0.00"}
                      disabled={isTodayCollectionClosed}
                    />
                  </label>
                  <label>
                    <span>Ruta</span>
                    {isCustomRouteEditorOpen ? (
                      <input
                        className="ar-route-list-route-custom"
                        type="text"
                        value={routeAssignment}
                        onChange={(event) => onRouteAssignmentChange(row.id, event.target.value)}
                        onBlur={(event) => {
                          const normalized = normalizeRouteAssignment(event.target.value);
                          if (event.target.value !== (normalized ?? "")) onRouteAssignmentChange(row.id, normalized ?? "");
                          if (!normalized) setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: false }));
                        }}
                        placeholder="Escribe ruta"
                        maxLength={12}
                        disabled={isTodayCollectionClosed}
                        aria-label={`Ruta manual de ${row.unitId}`}
                      />
                    ) : (
                      <select
                        className="ar-route-list-route"
                        value={routeAssignment}
                        onChange={(event) => {
                          const selected = event.target.value;
                          if (selected === "__custom") {
                            setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: true }));
                            onRouteAssignmentChange(row.id, "");
                            return;
                          }
                          setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: false }));
                          onRouteAssignmentChange(row.id, selected);
                        }}
                        disabled={isTodayCollectionClosed}
                        aria-label={`Ruta de ${row.unitId}`}
                      >
                        <option value="">Sin ruta</option>
                        {ROUTE_ASSIGNMENT_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                        <option value="__custom">Otra</option>
                      </select>
                    )}
                  </label>
                  <label>
                    <span>Alarma</span>
                    <select
                      className={`ar-route-urgency-select ar-route-urgency-select--${routeUrgency}`}
                      value={routeUrgency}
                      onChange={(event) => onRouteUrgencyChange(row.id, event.target.value as "normal" | "urgent" | "very_urgent")}
                      disabled={isTodayCollectionClosed}
                    >
                      {ROUTE_URGENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="ar-route-mobile-comment">
                    <span>Comentario</span>
                    <input
                      className="ar-route-list-comment"
                      type="text"
                      value={statusRecord?.managementComment ?? ""}
                      onChange={(event) => onRouteManagementCommentChange(row.id, event.target.value)}
                      placeholder="Comentario..."
                      maxLength={25}
                      disabled={isTodayCollectionClosed}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className="button ghost small ar-route-list-remove ar-route-mobile-remove"
                  onClick={() => onRemoveFromRoute(row.id)}
                  disabled={isTodayCollectionClosed}
                >
                  Sacar de ruta
                </button>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="table-scroll ar-ledger-scroll" ref={tableScrollRef}>
      <table className="ar-table ar-table--compact">
        <tbody>
          {viewMode === "historial" ? (
            selectedHistoryRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                  No hay datos en esta gestion.
                </td>
              </tr>
            ) : selectedHistoryRows.map((item) => (
              <tr key={`${selectedHistoryDate}-${item.clientId}`}>
                <td><strong className="ar-unit-id">{item.unitId}</strong></td>
                <td className="ar-pending-cell">
                  <div className="ar-client-money-layout">
                    <div className="ar-client-money-main">
                      <span className="client-name">{formatCurrency(item.totalPending)}</span>
                      <span className="debt-meta ar-truncate-line" title={item.clientName}>{item.clientName}</span>
                    </div>
                    <div className="ar-account-status-stack">
                      <span className="ar-last-payment-date">
                        {item.lastPaymentDate ? formatDate(new Date(`${item.lastPaymentDate}T12:00:00`)) : "Sin pagos"}
                      </span>
                      <span className={stateToneClass(item.receivableState as ReceivableState)}>
                        {STATE_LABEL[item.receivableState as ReceivableState] ?? item.receivableState}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="ar-support-note-cell"><span className="hint">-</span></td>
                <td className="ar-cut-cell ar-cut-cell--stacked">
                  <div className="ar-cut-stack">
                    {COLLECTION_CUT_OPTIONS.map((option) => (
                      <div key={option.key}>
                        {renderHistoryCutStack(item.cuts[option.key], option.key)}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))
          ) : rows.map((row) => (
            <ReceivableTableRow
              key={row.id}
              row={row}
              statusRecord={collectionStatusByClient[row.id]}
              operationalStatus={row.operationalStatus ?? clientStatusById.get(row.id) ?? "activo"}
              todayDateKey={todayDateKey}
              now={now}
              isTodayCollectionClosed={isTodayCollectionClosed}
              workflowTab={workflowTab}
              collectionCutItems={getCutItemsForClient(todayCollectionCuts, row.id)}
              visibleCutKey={visibleCollectionCut}
              whatsAppMessage={buildWhatsAppReceivableMessage(row)}
              whatsAppGroupRows={getWhatsAppGroupRows(row)}
              statementGroupRows={getStatementGroupRows(row)}
              onSelectDetail={onSelectDetail}
                onCollectionCutStatusChange={onCollectionCutStatusChange}
                onCollectionCutCommentChange={onCollectionCutCommentChange}
                onRouteTagChange={onRouteTagChange}
              onRouteManagementTypeChange={onRouteManagementTypeChange}
              onRouteManagementCommentChange={onRouteManagementCommentChange}
              onRouteAssignmentChange={onRouteAssignmentChange}
              onRouteUrgencyChange={onRouteUrgencyChange}
              onRouteReleaseAmountChange={onRouteReleaseAmountChange}
              onWhatsAppMessageSent={onWhatsAppMessageSent}
              onSupportNoteChange={onSupportNoteChange}
              onContactTimeChange={onContactTimeChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});
