import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction
} from "react";
import { parseDateKey } from "../../billing";
import { formatCurrency, formatDate } from "../../format";
import type { Client, PendingBankItem } from "../../types";
import { EMPTY_PENDING_FILTERS } from "./paymentConstants";
import { getPendingFines, getPendingTickets, roundMoney, toInputMoney } from "./paymentRules";
import type { PendingBankPreview, PendingColumnFilters } from "./paymentTypes";

type SimilaritySignals = {
  nombre: boolean;
  centavos: boolean;
  notificado: boolean;
  exacto: boolean;
  aplicable: boolean;
  score: number;
};

type Props = {
  pendingSectionRef: RefObject<HTMLElement>;
  isPendingOpen: boolean;
  pendingBankItems: PendingBankItem[];
  pendingImportError: string;
  pendingErrors: string[];
  isPendingImporting?: boolean;
  bulkPendingApplyingCount: number;
  clients: Client[];
  activeClients: Client[];
  getSimilaritySignals: (item: PendingBankItem) => SimilaritySignals;
  getPendingBankPreview: (item: PendingBankItem, client: Client | null) => PendingBankPreview | null;
  handleApplyAllAssigned: () => Promise<void>;
  handleDismissAllPending: () => void;
  pendingClassifyTarget: PendingBankItem | null;
  handleOpenClassify: (item: PendingBankItem) => void;
  handlePendingUnitChange: (item: PendingBankItem, clientId: string) => void;
  pendingTravelFundInputByFolio: Record<string, string>;
  setPendingTravelFundInputByFolio: Dispatch<SetStateAction<Record<string, string>>>;
  handleSavePendingClientTravelFund: (client: Client, folio: string) => void;
  pendingApplyingFolio: string | null;
  isPendingClassifySaving: boolean;
  handleQuickApply: (item: PendingBankItem) => Promise<void>;
  handleDismissPending: (folio: string) => void;
  renderPendingInlineReview: (item: PendingBankItem) => ReactNode;
};

type PendingBaseRowModel = {
  item: PendingBankItem;
  assignedClient: Client | null;
  hasOtherCharges: boolean;
  hasFines: boolean;
  hasTickets: boolean;
  signals: SimilaritySignals;
  actionLabels: string;
  unitLabel: string;
  groupLabel: string;
  nameLabel: string;
  similarityLabel: string;
};

type PendingRowModel = PendingBaseRowModel & {
  pendingPreview: PendingBankPreview | null;
  previewLabel: string;
};

const PENDING_PAGE_SIZE = 50;
const CLIENT_MATCH_LIMIT = 20;

function getPreviewFilterLabel(preview: PendingBankPreview | null): string {
  if (!preview) return "Sin vista previa";
  if (preview.isProvisionalRental) {
    return `Alquiler provisional Renta ${formatCurrency(preview.rentAmount)} ${preview.frequencyLabel} Pendientes antes ${preview.installmentsPendingBefore ?? 0} Pendientes despues ${preview.installmentsRemainingAfter} Cobro ${formatCurrency(preview.balanceAfter)}`;
  }
  return `Renta ${formatCurrency(preview.rentAmount)} ${preview.frequencyLabel} Multas ${formatCurrency(preview.totalFines)} Boletas ${formatCurrency(preview.totalTickets)} Recargos ${formatCurrency(preview.totalLateFees)} Otros cargos ${formatCurrency(Math.max(0, preview.totalOtherCharges - preview.totalLateFees))} Pactadas ${preview.installmentsAgreed} Cuotas ${preview.installmentsRemainingAfter} Impacto ${preview.installmentsDeducted} Cobro ${formatCurrency(preview.balanceAfter)}`;
}

export default function PendingBankPanel({
  pendingSectionRef,
  isPendingOpen,
  pendingBankItems,
  pendingImportError,
  pendingErrors,
  isPendingImporting = false,
  bulkPendingApplyingCount,
  clients,
  activeClients,
  getSimilaritySignals,
  getPendingBankPreview,
  handleApplyAllAssigned,
  handleDismissAllPending,
  pendingClassifyTarget,
  handleOpenClassify,
  handlePendingUnitChange,
  pendingTravelFundInputByFolio,
  setPendingTravelFundInputByFolio,
  handleSavePendingClientTravelFund,
  pendingApplyingFolio,
  isPendingClassifySaving,
  handleQuickApply,
  handleDismissPending,
  renderPendingInlineReview
}: Props) {
  const [pendingFilters, setPendingFilters] = useState<PendingColumnFilters>(() => ({ ...EMPTY_PENDING_FILTERS }));
  const pendingTopScrollRef = useRef<HTMLDivElement>(null);
  const pendingTopInnerRef = useRef<HTMLDivElement>(null);
  const pendingBottomScrollRef = useRef<HTMLDivElement>(null);
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const clientsByExactUnit = useMemo(() => {
    const index = new Map<string, Client[]>();
    for (const client of activeClients) {
      const unit = (client.activeProvisionalRental?.unitId ?? client.unitId).trim().toLowerCase();
      if (!unit) continue;
      const matches = index.get(unit);
      if (matches) matches.push(client);
      else index.set(unit, [client]);
    }
    return index;
  }, [activeClients]);
  const [pendingPage, setPendingPage] = useState(1);
  const [assignmentEditorFolio, setAssignmentEditorFolio] = useState<string | null>(null);
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const assignedPendingCount = useMemo(
    () => pendingBankItems.filter((item) => !!item.suggestedClientId && clientById.has(item.suggestedClientId)).length,
    [clientById, pendingBankItems]
  );

const hasPendingColumnFilters = useMemo(
  () => Object.values(pendingFilters).some((value) => value.trim().length > 0),
  [pendingFilters]
);

const preparedPendingRows = useMemo<PendingBaseRowModel[]>(() => {
  if (!isPendingOpen) return [];
  return pendingBankItems.map((item) => {
    const assignedClient = item.suggestedClientId ? (clientById.get(item.suggestedClientId) ?? null) : null;
    const hasOtherCharges = !!(assignedClient?.otherCharges?.length);
    const hasFines = assignedClient ? getPendingFines(assignedClient).length > 0 : false;
    const hasTickets = assignedClient ? getPendingTickets(assignedClient).length > 0 : false;
    const signals = getSimilaritySignals(item);
    const isHighSim = signals.aplicable && !!assignedClient;
    const unitProbability = signals.exacto || signals.score >= 3 ? "Alta" : signals.score === 2 ? "Media" : signals.score === 1 ? "Baja" : "Sin datos";
    const actionLabels = [
      assignedClient ? (hasOtherCharges || hasFines || hasTickets ? "Aplicar auto" : "Aplicar") : "",
      assignedClient && hasOtherCharges ? "Revisar cargos" : "",
      "Ignorar"
    ].filter(Boolean).join(" ");
    const unitLabel = assignedClient ? `${assignedClient.activeProvisionalRental?.unitId ?? assignedClient.unitId} ${assignedClient.name}` : "Sin asignar";
    const groupLabel = item.mappedGroup ? `Grupo ${item.mappedGroup}` : "";
    const nameLabel = item.suggestedClientName || item.extractedName || "";
    const similarityLabel = [
      isHighSim ? "Alta similitud" : "Sin alta similitud",
      `Probabilidad ${unitProbability}`,
      signals.nombre ? "nombre" : "",
      signals.centavos ? "centavos" : "",
      signals.notificado ? "notificado" : "",
      signals.exacto ? "coincidencia exacta" : "",
      hasFines ? "multas" : "",
      hasTickets ? "boletas" : "",
      hasOtherCharges ? "otros cargos" : ""
    ].filter(Boolean).join(" ");
    return {
      item,
      assignedClient,
      hasOtherCharges,
      hasFines,
      hasTickets,
      signals,
      actionLabels,
      unitLabel,
      groupLabel,
      nameLabel,
      similarityLabel
    };
  });
}, [clientById, getSimilaritySignals, isPendingOpen, pendingBankItems]);

const filteredPendingRows = useMemo(() => {
  const normalize = (value: string): string => value.trim().toLowerCase();
  const includesFilter = (target: string, filterValue: string): boolean => {
    const query = normalize(filterValue);
    if (!query) return true;
    return normalize(target).includes(query);
  };

  const asAmountLabel = (value: number): string => `${value.toFixed(2)} ${formatCurrency(value)}`;

  return preparedPendingRows.filter(({ item, actionLabels, unitLabel, groupLabel, nameLabel, similarityLabel }) => {
    return (
      includesFilter(item.folio, pendingFilters.folio) &&
      includesFilter(item.accountNumber ?? "", pendingFilters.account) &&
      includesFilter(groupLabel, pendingFilters.group) &&
      includesFilter(item.dateApplied, pendingFilters.date) &&
      includesFilter(asAmountLabel(item.amountReceived), pendingFilters.amount) &&
      includesFilter(nameLabel, pendingFilters.name) &&
      includesFilter(similarityLabel, pendingFilters.similarity) &&
      includesFilter(unitLabel, pendingFilters.unit) &&
      includesFilter(item.description, pendingFilters.description) &&
      includesFilter(actionLabels, pendingFilters.actions)
    );
  });
}, [pendingFilters, preparedPendingRows]);

const previewFilteredPendingRows = useMemo<Array<PendingBaseRowModel | PendingRowModel>>(() => {
  const query = pendingFilters.preview.trim().toLowerCase();
  if (!query) return filteredPendingRows;
  return filteredPendingRows
    .map((row): PendingRowModel => {
      const pendingPreview = getPendingBankPreview(row.item, row.assignedClient);
      return { ...row, pendingPreview, previewLabel: getPreviewFilterLabel(pendingPreview) };
    })
    .filter((row) => row.previewLabel.toLowerCase().includes(query));
}, [filteredPendingRows, getPendingBankPreview, pendingFilters.preview]);

const totalPendingPages = Math.max(1, Math.ceil(previewFilteredPendingRows.length / PENDING_PAGE_SIZE));
const visiblePendingPage = Math.min(pendingPage, totalPendingPages);
const pagedPendingRows = useMemo<PendingRowModel[]>(() => {
  const pageRows = previewFilteredPendingRows.slice(
    (visiblePendingPage - 1) * PENDING_PAGE_SIZE,
    visiblePendingPage * PENDING_PAGE_SIZE
  );
  return pageRows.map((row) => {
    if ("pendingPreview" in row) return row;
    const pendingPreview = getPendingBankPreview(row.item, row.assignedClient);
    return { ...row, pendingPreview, previewLabel: getPreviewFilterLabel(pendingPreview) };
  });
}, [getPendingBankPreview, previewFilteredPendingRows, visiblePendingPage]);

const assignmentMatches = useMemo(() => {
  if (!assignmentEditorFolio) return [];
  const query = assignmentSearch.trim().toLowerCase();
  if (!query) return [];
  return activeClients
    .filter((client) => `${client.activeProvisionalRental?.unitId ?? client.unitId} ${client.name} ${client.cedula ?? ""}`.toLowerCase().includes(query))
    .slice(0, CLIENT_MATCH_LIMIT);
}, [activeClients, assignmentEditorFolio, assignmentSearch]);

function updatePendingFilter(field: keyof PendingColumnFilters, value: string): void {
  setPendingPage(1);
  setPendingFilters((prev) => ({ ...prev, [field]: value }));
}

function clearPendingFilters(): void {
  setPendingPage(1);
  setPendingFilters({ ...EMPTY_PENDING_FILTERS });
}

function toggleAssignmentEditor(folio: string): void {
  setAssignmentEditorFolio((current) => current === folio ? null : folio);
  setAssignmentSearch("");
}

function selectPendingClient(item: PendingBankItem, clientId: string): void {
  handlePendingUnitChange(item, clientId);
  setAssignmentEditorFolio(null);
  setAssignmentSearch("");
}

function updateAssignmentSearch(item: PendingBankItem, value: string, isInlineReviewOpen: boolean): void {
  setAssignmentSearch(value);
  const query = value.trim().toLowerCase();
  const exactMatches = clientsByExactUnit.get(query) ?? [];
  if (exactMatches.length !== 1) return;

  const searchMatches = activeClients.filter((client) => (
    `${client.activeProvisionalRental?.unitId ?? client.unitId} ${client.name} ${client.cedula ?? ""}`
      .toLowerCase()
      .includes(query)
  ));
  if (searchMatches.length !== 1 || searchMatches[0].id !== exactMatches[0].id) return;

  if (isInlineReviewOpen) handleOpenClassify(item);
  selectPendingClient(item, exactMatches[0].id);
}

useEffect(() => {
  if (!isPendingOpen) return;
  const top = pendingTopScrollRef.current;
  const bottom = pendingBottomScrollRef.current;
  if (!top || !bottom) return;

  let syncing = false;
  const onTopScroll = () => {
    if (syncing) return;
    syncing = true;
    bottom.scrollLeft = top.scrollLeft;
    syncing = false;
  };
  const onBottomScroll = () => {
    if (syncing) return;
    syncing = true;
    top.scrollLeft = bottom.scrollLeft;
    syncing = false;
  };

  top.addEventListener("scroll", onTopScroll, { passive: true });
  bottom.addEventListener("scroll", onBottomScroll, { passive: true });
  return () => {
    top.removeEventListener("scroll", onTopScroll);
    bottom.removeEventListener("scroll", onBottomScroll);
  };
}, [isPendingOpen, pendingBankItems.length]);

useEffect(() => {
  if (!isPendingOpen) return;
  const top = pendingTopScrollRef.current;
  const topInner = pendingTopInnerRef.current;
  const bottom = pendingBottomScrollRef.current;
  if (!top || !topInner || !bottom) return;

  const updateTopWidth = () => {
    const table = bottom.querySelector("table");
    const width = table ? table.scrollWidth : bottom.scrollWidth;
    topInner.style.width = `${Math.max(width, bottom.clientWidth)}px`;
    top.scrollLeft = bottom.scrollLeft;
  };

  updateTopWidth();
  window.addEventListener("resize", updateTopWidth);
  return () => {
    window.removeEventListener("resize", updateTopWidth);
  };
}, [isPendingOpen, pendingBankItems.length, activeClients.length]);

  return (
    <section id="payment-panel-pending" role="tabpanel" aria-labelledby="payment-tab-pending" ref={pendingSectionRef} className="panel" style={{ display: isPendingOpen ? undefined : "none" }}>
            <div className="panel-head">
              <h2>
                Pendientes del banco
                {pendingBankItems.length > 0 && (
                  <span className="badge-count">{pendingBankItems.length}</span>
                )}
              </h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {assignedPendingCount > 0 && (
                  <button
                    type="button"
                    className="button primary small"
                    disabled={bulkPendingApplyingCount > 0}
                    onClick={() => void handleApplyAllAssigned()}
                  >
                    {bulkPendingApplyingCount > 0
                      ? `Aplicando ${bulkPendingApplyingCount}...`
                      : `Aplicar todos los asignados (${assignedPendingCount})`}
                  </button>
                )}
                {pendingBankItems.length > 0 && (
                  <button type="button" className="button danger small" disabled={bulkPendingApplyingCount > 0} onClick={handleDismissAllPending}>
                    Ignorar todos
                  </button>
                )}
              </div>
            </div>

            {pendingImportError && (
              <p className={`hint ${pendingImportError.startsWith("Error") || pendingImportError.startsWith("No se") ? "error-text" : "recon-info"}`} style={{ marginTop: 8 }}>
                {pendingImportError}
              </p>
            )}

            {pendingErrors.length > 0 && (
              <div className="hint error-text" role="alert" aria-live="assertive" style={{ marginTop: 8 }}>
                {pendingErrors.map((message) => <div key={message}>{message}</div>)}
              </div>
            )}

            {isPendingImporting && (
              <p className="hint recon-info" role="status" aria-live="polite" style={{ marginTop: 8 }}>
                Validando folios y preparando movimientos pendientes...
              </p>
            )}

            {isPendingOpen && (
              <>
                <p className="hint" style={{ marginTop: 8 }}>
                  La importacion aplica regla automatica por cuenta y grupo. Si el cliente tiene multas, boletas u otros cargos, se cobran automaticamente antes de renta; usa Revisar cargos solo cuando necesites ajustar otros cargos de ese pago.
                </p>
                {hasPendingColumnFilters && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" className="button ghost small" onClick={clearPendingFilters}>
                      Limpiar filtros
                    </button>
                  </div>
                )}
                {pendingBankItems.length === 0 ? (
                <p className="empty">No hay movimientos pendientes de asignar cliente.</p>
                ) : (
                  <>
                  <div className="top-scroll" ref={pendingTopScrollRef} style={{ marginTop: 10 }}>
                    <div ref={pendingTopInnerRef} className="top-scroll-inner" />
                  </div>
                  <div className="table-scroll" ref={pendingBottomScrollRef}>
                    <table>
                      <thead>
                        <tr>
                          <th>Folio</th>
                          <th>Cuenta</th>
                          <th>Grupo</th>
                          <th>Fecha</th>
                          <th>Monto</th>
                          <th>Nombre extraido</th>
                          <th>Similitud</th>
                          <th>Unidad</th>
                          <th>Vista previa</th>
                          <th>Descripcion</th>
                          <th>Acciones</th>
                        </tr>
                        <tr>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.folio} onChange={(e) => updatePendingFilter("folio", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.account} onChange={(e) => updatePendingFilter("account", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.group} onChange={(e) => updatePendingFilter("group", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.date} onChange={(e) => updatePendingFilter("date", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.amount} onChange={(e) => updatePendingFilter("amount", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.name} onChange={(e) => updatePendingFilter("name", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.similarity} onChange={(e) => updatePendingFilter("similarity", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.unit} onChange={(e) => updatePendingFilter("unit", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.preview} onChange={(e) => updatePendingFilter("preview", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.description} onChange={(e) => updatePendingFilter("description", e.target.value)} /></th>
                          <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.actions} onChange={(e) => updatePendingFilter("actions", e.target.value)} /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedPendingRows.map(({ item, assignedClient, hasOtherCharges, hasFines, hasTickets, signals, pendingPreview }) => {
                          const isPreMatched = !!item.suggestedClientId;
                          const { nombre, centavos, notificado, exacto, aplicable, score } = signals;
                          const isHighSim = aplicable && !!assignedClient;
                          const unitProbability = exacto || score >= 3 ? "Alta" : score === 2 ? "Media" : score === 1 ? "Baja" : "Sin datos";
                          const rowClass = isHighSim ? "pending-row--high-sim" : (hasOtherCharges || hasFines || hasTickets) ? "pending-row--other-charges" : isPreMatched ? "pending-row--ready" : "";
                          const upToDateUntilDate = pendingPreview?.upToDateUntil
                            ? parseDateKey(pendingPreview.upToDateUntil)
                            : null;
                          const installmentsImpact = (pendingPreview?.installmentsDeducted ?? 0) + (pendingPreview?.installmentsCoveredByAdvance ?? 0);
                          const isInlineReviewOpen = pendingClassifyTarget?.folio === item.folio;
                          return [
                            <tr key={`${item.folio}-row`} className={rowClass}>
                              <td><code>{item.folio}</code></td>
                              <td>{item.accountNumber ? <code>{item.accountNumber}</code> : <span className="amount-muted">-</span>}</td>
                              <td>{item.mappedGroup ? `Grupo ${item.mappedGroup}` : <span className="amount-muted">-</span>}</td>
                              <td>{item.dateApplied}</td>
                              <td><span className="amount-good">{formatCurrency(item.amountReceived)}</span></td>
                              <td>
                                {isPreMatched
                                  ? <>
                                      {(hasOtherCharges || hasFines || hasTickets) && <span className="badge-other-charges" title={hasFines ? "Cliente con multas pendientes" : hasTickets ? "Cliente con boletas pendientes" : "Cliente con otros cargos"}>*</span>}
                                      {notificado && <span className="badge-notified" title="Pago notificado">OK</span>}
                                      {centavos && <span className="badge-cents" title="Pago con centavos">c</span>}
                                      {item.suggestedClientName}
                                    </>
                                  : item.extractedName || <span className="amount-muted">-</span>}
                              </td>
                              <td>
                                {isHighSim && (
                                  <span className="badge-sim" title={`Alta similitud: ${[nombre && "nombre", centavos && "centavos", notificado && "notificado", exacto && "coincidencia exacta"].filter(Boolean).join(", ")}`}>
                                    Alta similitud
                                  </span>
                                )}
                              </td>
                              <td>
                                <div className={`unit-prob unit-prob--${exacto || score >= 3 ? "high" : score === 2 ? "medium" : "low"}`}>
                                  Probabilidad: {unitProbability}
                                </div>
                                {assignedClient && (
                                  <div className="unit-preview">{assignedClient.activeProvisionalRental?.unitId ?? assignedClient.unitId} - {assignedClient.name}</div>
                                )}
                                <button
                                  type="button"
                                  className="button ghost small"
                                  aria-expanded={assignmentEditorFolio === item.folio}
                                  onClick={() => toggleAssignmentEditor(item.folio)}
                                >
                                  {assignmentEditorFolio === item.folio ? "Cerrar búsqueda" : assignedClient ? "Cambiar cliente" : "Asignar cliente"}
                                </button>
                                {assignmentEditorFolio === item.folio && (
                                  <div style={{ marginTop: 6, display: "grid", gap: 6, minWidth: 240 }}>
                                    <input
                                      type="search"
                                      className="payment-input"
                                      aria-label={`Buscar cliente para folio ${item.folio}`}
                                      placeholder="Unidad, nombre o cédula"
                                      value={assignmentSearch}
                                      onChange={(event) => updateAssignmentSearch(item, event.target.value, isInlineReviewOpen)}
                                      autoFocus
                                    />
                                    {assignmentSearch.trim() && (
                                      <select
                                        className="payment-input pending-unit-select"
                                        aria-label={`Resultados de cliente para folio ${item.folio}`}
                                        value=""
                                        onChange={(event) => {
                                          if (!event.target.value) return;
                                          if (isInlineReviewOpen) handleOpenClassify(item);
                                          selectPendingClient(item, event.target.value);
                                        }}
                                      >
                                        <option value="">Selecciona un resultado ({assignmentMatches.length})</option>
                                        {assignmentMatches.map((client) => (
                                          <option key={client.id} value={client.id}>
                                            {client.activeProvisionalRental?.unitId ?? client.unitId} - {client.name}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    {assignmentSearch.trim() && assignmentMatches.length === 0 && (
                                      <span className="amount-muted">No se encontraron clientes.</span>
                                    )}
                                    {assignedClient && (
                                      <button type="button" className="button ghost small" onClick={() => selectPendingClient(item, "")}>
                                        Quitar asignación
                                      </button>
                                    )}
                                  </div>
                                )}
                                {!item.suggestedClientId && (
                                  <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>Asignar Cliente</div>
                                )}
                                {assignedClient && (
                                  <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                    <input
                                      type="number"
                                      className="payment-input"
                                      min="0"
                                      step="0.01"
                                      value={pendingTravelFundInputByFolio[item.folio] ?? toInputMoney(roundMoney(Math.max(0, assignedClient.travelFundBalance ?? 0)))}
                                      onChange={(e) =>
                                        setPendingTravelFundInputByFolio((prev) => ({ ...prev, [item.folio]: e.target.value }))
                                      }
                                      placeholder="Fondo viaje"
                                      style={{ width: 120 }}
                                    />
                                    <button
                                      type="button"
                                      className="button ghost small"
                                      onClick={() => handleSavePendingClientTravelFund(assignedClient, item.folio)}
                                    >
                                      Guardar fondo
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td>
                                {pendingPreview ? (
                                  <div className="pending-preview-card">
                                    {pendingPreview.isProvisionalRental && (
                                      <div className="provisional-rental-row-badge">
                                        AUTO PROVISIONAL/ALQUILER DE AUTO
                                      </div>
                                    )}
                                    <div className="pending-preview-row"><span>Renta</span><strong>{formatCurrency(pendingPreview.rentAmount)}</strong></div>
                                    <div className="pending-preview-row"><span>Frecuencia</span><strong>{pendingPreview.frequencyLabel}</strong></div>
                                    {pendingPreview.totalFines > 0 && (
                                      <div className="pending-preview-row">
                                        <span>Multas</span>
                                        <strong className="amount-warning">{formatCurrency(pendingPreview.totalFines)}</strong>
                                      </div>
                                    )}
                                    {pendingPreview.totalTickets > 0 && (
                                      <div className="pending-preview-row">
                                        <span>Boletas</span>
                                        <strong className="amount-warning">{formatCurrency(pendingPreview.totalTickets)}</strong>
                                      </div>
                                    )}
                                    {pendingPreview.totalLateFees > 0 && (
                                      <div className="pending-preview-row">
                                        <span>Recargos por mora</span>
                                        <strong className="amount-warning">{formatCurrency(pendingPreview.totalLateFees)}</strong>
                                      </div>
                                    )}
                                    {roundMoney(Math.max(0, pendingPreview.totalOtherCharges - pendingPreview.totalLateFees)) > 0 && (
                                      <div className="pending-preview-row">
                                        <span>{pendingPreview.forcedOtherChargesRuleApplied ? "Otros cargos auto" : "Otros cargos"}</span>
                                        <strong className="amount-warning">{formatCurrency(Math.max(0, pendingPreview.totalOtherCharges - pendingPreview.totalLateFees))}</strong>
                                      </div>
                                    )}
                                    {pendingPreview.isProvisionalRental ? (
                                      <>
                                        <div className="pending-preview-row"><span>Cuotas de alquiler pendientes</span><strong>{pendingPreview.installmentsPendingBefore ?? 0}</strong></div>
                                        <div className="pending-preview-row"><span>Pendientes despues del pago</span><strong>{pendingPreview.installmentsRemainingAfter}</strong></div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="pending-preview-row"><span>Cuotas pactadas</span><strong>{pendingPreview.installmentsAgreed}</strong></div>
                                        <div className="pending-preview-row"><span>Cuotas restantes despues del pago</span><strong>{pendingPreview.installmentsRemainingAfter}</strong></div>
                                      </>
                                    )}
                                    {!pendingPreview.isProvisionalRental && pendingPreview.balanceAfter <= 0 && (
                                      <div className="pending-preview-row">
                                        <span>Al dia hasta</span>
                                        <strong className="amount-good">{upToDateUntilDate ? formatDate(upToDateUntilDate) : "-"}</strong>
                                      </div>
                                    )}
                                    <div className="pending-preview-row">
                                      <span>Impacto de cuotas</span>
                                      <strong className={installmentsImpact > 0 ? "amount-good" : "amount-muted"}>
                                        {installmentsImpact > 0
                                          ? `-${installmentsImpact} ${installmentsImpact === 1 ? "cuota" : "cuotas"}`
                                          : "Sin cambio"}
                                      </strong>
                                    </div>
                                    <div className="pending-preview-row">
                                      <span>{pendingPreview.isProvisionalRental ? "Saldo pendiente despues del pago" : "Monto a cobrar"}</span>
                                      <strong className={pendingPreview.balanceAfter > 0 ? "amount-debt" : "amount-good"}>{formatCurrency(pendingPreview.balanceAfter)}</strong>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="amount-muted">Asigna cliente para ver vista previa</span>
                                )}
                              </td>
                              <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.description}>{item.description}</td>
                              <td className="actions-cell">
                                {assignedClient && (
                                  <button
                                    type="button"
                                    className="button primary small"
                                    disabled={pendingApplyingFolio !== null || isPendingClassifySaving || bulkPendingApplyingCount > 0}
                                    onClick={() => void handleQuickApply(item)}
                                  >
                                    {pendingApplyingFolio === item.folio ? "Aplicando..." : (hasOtherCharges || hasFines || hasTickets) ? "Aplicar auto" : "Aplicar"}
                                  </button>
                                )}
                                {assignedClient && hasOtherCharges && (
                                  <button type="button" className="button ghost small" disabled={bulkPendingApplyingCount > 0} onClick={() => handleOpenClassify(item)}>
                                    {isInlineReviewOpen ? "Cerrar revision" : "Revisar cargos"}
                                  </button>
                                )}
                                <button type="button" className="button danger small" disabled={bulkPendingApplyingCount > 0} onClick={() => handleDismissPending(item.folio)}>
                                  Ignorar
                                </button>
                              </td>
                            </tr>,
                            isInlineReviewOpen ? (
                              <tr key={`${item.folio}-review`} className="pending-inline-review-row">
                                <td colSpan={11}>{renderPendingInlineReview(item)}</td>
                              </tr>
                            ) : null
                          ];
                        })}
                        {previewFilteredPendingRows.length === 0 && (
                          <tr>
                            <td colSpan={11}>
                              <span className="amount-muted">No hay resultados con los filtros actuales.</span>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {previewFilteredPendingRows.length > PENDING_PAGE_SIZE && (
                    <div
                      className="pagination"
                      aria-label="Páginas de pendientes"
                      style={{ marginTop: 10, display: "flex", justifyContent: "center", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                    >
                      <button
                        type="button"
                        className="button ghost small"
                        disabled={visiblePendingPage <= 1}
                        onClick={() => setPendingPage((current) => Math.max(1, current - 1))}
                      >
                        Anterior
                      </button>
                      <span>
                        Página {visiblePendingPage} de {totalPendingPages} · {previewFilteredPendingRows.length} pendientes
                      </span>
                      <button
                        type="button"
                        className="button ghost small"
                        disabled={visiblePendingPage >= totalPendingPages}
                        onClick={() => setPendingPage((current) => Math.min(totalPendingPages, current + 1))}
                      >
                        Siguiente
                      </button>
                    </div>
                  )}
                  </>
                )}
              </>
            )}
          </section>

  );
}
