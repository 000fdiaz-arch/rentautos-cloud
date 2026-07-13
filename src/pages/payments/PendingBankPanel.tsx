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
import { roundMoney, toInputMoney } from "./paymentRules";
import type { PendingBankPreview, PendingColumnFilters } from "./paymentTypes";

type SimilaritySignals = {
  nombre: boolean;
  centavos: boolean;
  notificado: boolean;
  score: number;
};

type Props = {
  pendingSectionRef: RefObject<HTMLElement>;
  isPendingOpen: boolean;
  pendingBankItems: PendingBankItem[];
  pendingImportError: string;
  clients: Client[];
  activeClients: Client[];
  getSimilaritySignals: (item: PendingBankItem) => SimilaritySignals;
  getPendingBankPreview: (item: PendingBankItem, client: Client | null) => PendingBankPreview | null;
  handleApplyAllHighSimilarity: () => Promise<void>;
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

export default function PendingBankPanel({
  pendingSectionRef,
  isPendingOpen,
  pendingBankItems,
  pendingImportError,
  clients,
  activeClients,
  getSimilaritySignals,
  getPendingBankPreview,
  handleApplyAllHighSimilarity,
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

const hasPendingColumnFilters = useMemo(
  () => Object.values(pendingFilters).some((value) => value.trim().length > 0),
  [pendingFilters]
);

const filteredPendingBankItems = useMemo(() => {
  const normalize = (value: string): string => value.trim().toLowerCase();
  const includesFilter = (target: string, filterValue: string): boolean => {
    const query = normalize(filterValue);
    if (!query) return true;
    return normalize(target).includes(query);
  };

  const asAmountLabel = (value: number): string => `${value.toFixed(2)} ${formatCurrency(value)}`;

  return pendingBankItems.filter((item) => {
    const assignedClient = item.suggestedClientId ? (clientById.get(item.suggestedClientId) ?? null) : null;
    const hasOtherCharges = !!(assignedClient?.otherCharges?.length);
    const { nombre, centavos, notificado, score } = getSimilaritySignals(item);
    const isHighSim = score >= 2 && !!assignedClient;
    const unitProbability = score >= 3 ? "Alta" : score === 2 ? "Media" : score === 1 ? "Baja" : "Sin datos";
    const pendingPreview = getPendingBankPreview(item, assignedClient);
    const actionLabels = [
      assignedClient ? (hasOtherCharges ? "Aplicar auto" : "Aplicar") : "",
      assignedClient && hasOtherCharges ? "Editar cargos" : "",
      "Ignorar"
    ].filter(Boolean).join(" ");
    const previewLabel = pendingPreview
      ? `Renta ${formatCurrency(pendingPreview.rentAmount)} ${pendingPreview.frequencyLabel} Otros cargos ${formatCurrency(pendingPreview.totalOtherCharges)} Pactadas ${pendingPreview.installmentsAgreed} Cuotas ${pendingPreview.installmentsRemainingAfter} Impacto ${pendingPreview.installmentsDeducted} Cobro ${formatCurrency(pendingPreview.balanceAfter)}`
      : "Sin vista previa";
    const unitLabel = assignedClient ? `${assignedClient.unitId} ${assignedClient.name}` : "Sin asignar";
    const groupLabel = item.mappedGroup ? `Grupo ${item.mappedGroup}` : "";
    const nameLabel = item.suggestedClientName || item.extractedName || "";
    const similarityLabel = [
      isHighSim ? "Alta similitud" : "Sin alta similitud",
      `Probabilidad ${unitProbability}`,
      nombre ? "nombre" : "",
      centavos ? "centavos" : "",
      notificado ? "notificado" : "",
      hasOtherCharges ? "otros cargos" : ""
    ].filter(Boolean).join(" ");

    return (
      includesFilter(item.folio, pendingFilters.folio) &&
      includesFilter(item.accountNumber ?? "", pendingFilters.account) &&
      includesFilter(groupLabel, pendingFilters.group) &&
      includesFilter(item.dateApplied, pendingFilters.date) &&
      includesFilter(asAmountLabel(item.amountReceived), pendingFilters.amount) &&
      includesFilter(nameLabel, pendingFilters.name) &&
      includesFilter(similarityLabel, pendingFilters.similarity) &&
      includesFilter(unitLabel, pendingFilters.unit) &&
      includesFilter(previewLabel, pendingFilters.preview) &&
      includesFilter(item.description, pendingFilters.description) &&
      includesFilter(actionLabels, pendingFilters.actions)
    );
  });
}, [clientById, pendingBankItems, pendingFilters, getSimilaritySignals, getPendingBankPreview]);

function updatePendingFilter(field: keyof PendingColumnFilters, value: string): void {
  setPendingFilters((prev) => ({ ...prev, [field]: value }));
}

function clearPendingFilters(): void {
  setPendingFilters({ ...EMPTY_PENDING_FILTERS });
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
                {pendingBankItems.some((item) => {
                  const { score } = getSimilaritySignals(item);
                  if (score < 2) return false;
                  const c = clients.find((cl) => cl.id === item.suggestedClientId);
                  return !!c;
                }) && (
                  <button type="button" className="button primary small" onClick={() => void handleApplyAllHighSimilarity()}>
                    Aplicar alta similitud
                  </button>
                )}
                {pendingBankItems.length > 0 && (
                  <button type="button" className="button danger small" onClick={handleDismissAllPending}>
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

            {isPendingOpen && (
              <>
                <p className="hint" style={{ marginTop: 8 }}>
                  La importacion aplica regla automatica por cuenta y grupo. Si el cliente tiene otros cargos, se usa la tabla de Configuraciones automaticamente; usa Editar cargos solo cuando necesites ajustar ese pago.
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
                        {filteredPendingBankItems.map((item) => {
                          const assignedClient = item.suggestedClientId ? clients.find((c) => c.id === item.suggestedClientId) ?? null : null;
                          const hasOtherCharges = !!(assignedClient?.otherCharges?.length);
                          const isPreMatched = !!item.suggestedClientId;
                          const { nombre, centavos, notificado, score } = getSimilaritySignals(item);
                          const isHighSim = score >= 2 && !!assignedClient;
                          const unitProbability = score >= 3 ? "Alta" : score === 2 ? "Media" : score === 1 ? "Baja" : "Sin datos";
                          const rowClass = isHighSim ? "pending-row--high-sim" : hasOtherCharges ? "pending-row--other-charges" : isPreMatched ? "pending-row--ready" : "";
                          const pendingPreview = getPendingBankPreview(item, assignedClient);
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
                                      {hasOtherCharges && <span className="badge-other-charges" title="Cliente con otros cargos">*</span>}
                                      {notificado && <span className="badge-notified" title="Pago notificado">OK</span>}
                                      {centavos && <span className="badge-cents" title="Pago con centavos">c</span>}
                                      {item.suggestedClientName}
                                    </>
                                  : item.extractedName || <span className="amount-muted">-</span>}
                              </td>
                              <td>
                                {isHighSim && (
                                  <span className="badge-sim" title={`Alta similitud: ${[nombre && "nombre", centavos && "centavos", notificado && "notificado"].filter(Boolean).join(", ")}`}>
                                    Alta similitud
                                  </span>
                                )}
                              </td>
                              <td>
                                <div className={`unit-prob unit-prob--${score >= 3 ? "high" : score === 2 ? "medium" : "low"}`}>
                                  Probabilidad: {unitProbability}
                                </div>
                                {assignedClient && (
                                  <div className="unit-preview">{assignedClient.unitId} - {assignedClient.name}</div>
                                )}
                                <select
                                  className="payment-input pending-unit-select"
                                  value={item.suggestedClientId ?? ""}
                                  onChange={(e) => {
                                    if (isInlineReviewOpen) handleOpenClassify(item);
                                    handlePendingUnitChange(item, e.target.value);
                                  }}
                                >
                                  <option value="">Asignar cliente</option>
                                  {activeClients.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.unitId} - {c.name}
                                    </option>
                                  ))}
                                </select>
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
                                    <div className="pending-preview-row"><span>Renta</span><strong>{formatCurrency(pendingPreview.rentAmount)}</strong></div>
                                    <div className="pending-preview-row"><span>Frecuencia</span><strong>{pendingPreview.frequencyLabel}</strong></div>
                                    {pendingPreview.totalOtherCharges > 0 && (
                                      <div className="pending-preview-row">
                                        <span>{pendingPreview.forcedOtherChargesRuleApplied ? "Otros cargos auto" : "Otros cargos"}</span>
                                        <strong className="amount-warning">{formatCurrency(pendingPreview.totalOtherCharges)}</strong>
                                      </div>
                                    )}
                                    <div className="pending-preview-row"><span>Cuotas pactadas</span><strong>{pendingPreview.installmentsAgreed}</strong></div>
                                    <div className="pending-preview-row"><span>Cuotas restantes despues del pago</span><strong>{pendingPreview.installmentsRemainingAfter}</strong></div>
                                    {pendingPreview.balanceAfter <= 0 && (
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
                                    <div className="pending-preview-row"><span>Monto a cobrar</span><strong className={pendingPreview.balanceAfter > 0 ? "amount-debt" : "amount-good"}>{formatCurrency(pendingPreview.balanceAfter)}</strong></div>
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
                                    disabled={pendingApplyingFolio !== null || isPendingClassifySaving}
                                    onClick={() => void handleQuickApply(item)}
                                  >
                                    {pendingApplyingFolio === item.folio ? "Aplicando..." : hasOtherCharges ? "Aplicar auto" : "Aplicar"}
                                  </button>
                                )}
                                {assignedClient && hasOtherCharges && (
                                  <button type="button" className="button ghost small" onClick={() => handleOpenClassify(item)}>
                                    {isInlineReviewOpen ? "Cerrar edición" : "Editar cargos"}
                                  </button>
                                )}
                                <button type="button" className="button danger small" onClick={() => handleDismissPending(item.folio)}>
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
                        {filteredPendingBankItems.length === 0 && (
                          <tr>
                            <td colSpan={11}>
                              <span className="amount-muted">No hay resultados con los filtros actuales.</span>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </>
            )}
          </section>

  );
}
