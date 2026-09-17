import { useMemo, useState } from "react";
import { PLAN_LABEL, type ReceivableRow } from "../../receivables";
import type { BillingFrequency, Client, Payment } from "../../types";
import { ROUTE_ASSIGNMENT_OPTIONS, ROUTE_URGENCY_OPTIONS } from "./receivablesPageRules";
import type { CollectionStatusRecord, FieldManagementType, RouteUrgency } from "./receivablesTypes";
import {
  buildPriorityReceivables,
  formatCalendarDuration,
  formatElapsedPayment,
  formatWholeCurrency,
  priorityOverdueInstallmentCount,
  priorityPaymentDaysAgo,
  priorityTenureBucket,
  routeUrgencyForPriority,
  summarizeInstallmentDebt,
  type PriorityTenureBucket,
  type PriorityPaymentSummary,
  type PriorityReceivable,
  type ReceivablePriorityLevel
} from "./receivablesPriority";
import "./receivablesPriority.css";

export type PriorityRouteRequest = {
  clientId: string;
  releaseAmount: number;
  routeAssignment: string;
  managementType: FieldManagementType;
  urgency: RouteUrgency;
  comment: string;
};

type Props = {
  rows: ReceivableRow[];
  clients: Client[];
  payments: Payment[];
  collectionStatusByClient: Record<string, CollectionStatusRecord>;
  now: Date;
  readOnly: boolean;
  onSendToRoute: (request: PriorityRouteRequest) => void;
  onRemoveFromRoute: (clientId: string) => void;
  onOpenRoute: () => void;
  onDebtCapChange: (clientId: string, value: number | null) => void;
};

type LevelFilter = "all" | ReceivablePriorityLevel;
type TenureFilter = "all" | PriorityTenureBucket;
type PaymentDaysFilter = "all" | "no_payments" | `${number}`;
type PlanFilter = "all" | BillingFrequency;
type InstallmentFilter = "all" | `${number}`;
type PriorityFacet = "level" | "plan" | "installments" | "payment" | "tenure";

type PriorityFilterValues = {
  level: LevelFilter;
  plan: PlanFilter;
  installments: InstallmentFilter;
  payment: PaymentDaysFilter;
  tenure: TenureFilter;
};

type RouteDraft = {
  item: PriorityReceivable;
  amount: string;
  routeAssignment: string;
  customRoute: boolean;
  managementType: FieldManagementType;
  urgency: RouteUrgency;
  comment: string;
};

const LEVEL_LABEL: Record<ReceivablePriorityLevel, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Medio",
  low: "Bajo"
};

const TENURE_FILTER_OPTIONS: Array<{ value: TenureFilter; label: string }> = [
  { value: "all", label: "Toda antigüedad" },
  { value: "up_to_30", label: "Hasta 1 mes" },
  { value: "one_to_three", label: "1 a 3 meses" },
  { value: "three_to_six", label: "3 a 6 meses" },
  { value: "six_to_twelve", label: "6 a 12 meses" },
  { value: "one_to_two_years", label: "1 a 2 años" },
  { value: "two_years_plus", label: "2 años o más" }
];

const PLAN_FILTER_OPTIONS: BillingFrequency[] = ["daily", "weekly", "biweekly", "monthly"];

function inputMoney(value: number): string {
  return String(Math.round(value));
}

function shortDate(value: string | null): string {
  if (!value) return "fecha desconocida";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PA", { day: "numeric", month: "short" }).format(date).replace(".", "");
}

function normalizedRoute(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 12);
}

function normalizedUnitSearch(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

function matchesPriorityFilters(
  item: PriorityReceivable,
  now: Date,
  filters: PriorityFilterValues,
  omittedFacet?: PriorityFacet
): boolean {
  if (omittedFacet !== "level" && filters.level !== "all" && item.level !== filters.level) return false;
  if (omittedFacet !== "plan" && filters.plan !== "all" && item.row.plan !== filters.plan) return false;
  if (
    omittedFacet !== "installments"
    && filters.installments !== "all"
    && priorityOverdueInstallmentCount(item.row.overdueBalance, item.row.rentAmount) !== Number(filters.installments)
  ) return false;
  if (omittedFacet !== "payment" && filters.payment !== "all") {
    const paymentDays = priorityPaymentDaysAgo(item.lastPayment, now);
    if (filters.payment === "no_payments" ? paymentDays !== null : paymentDays !== Number(filters.payment)) return false;
  }
  if (
    omittedFacet !== "tenure"
    && filters.tenure !== "all"
    && priorityTenureBucket(item.tenureDays) !== filters.tenure
  ) return false;
  return true;
}

function paymentReading(payment: PriorityPaymentSummary | null, now: Date): {
  elapsed: string;
  detail: string;
  tone: "recent" | "attention" | "stale";
} {
  if (!payment) return { elapsed: "Sin pagos registrados", detail: "", tone: "stale" };
  const days = priorityPaymentDaysAgo(payment, now) ?? 0;
  const elapsed = formatElapsedPayment(payment.dateApplied, now);
  const rent = Math.max(0, payment.appliedToRent);
  const visibleCharges = payment.otherCharges.filter((charge) => Math.round(Math.max(0, charge.amount)) > 0);
  const distribution = [
    Math.round(rent) > 0 ? `Renta ${formatWholeCurrency(rent)}` : "",
    ...visibleCharges.map((charge) => `${charge.label} ${formatWholeCurrency(charge.amount)}`)
  ].filter(Boolean);
  const paid = Math.round(Math.max(0, payment.amountReceived)) > 0
    ? `Pagó ${formatWholeCurrency(payment.amountReceived)}`
    : "Pago registrado";
  return {
    elapsed: elapsed.charAt(0).toLocaleUpperCase("es") + elapsed.slice(1),
    detail: distribution.length > 0 ? `${paid} · ${distribution.join(" · ")}` : paid,
    tone: days > 30 ? "stale" : days >= 8 ? "attention" : "recent"
  };
}

export function ReceivablesPriorityList({
  rows,
  clients,
  payments,
  collectionStatusByClient,
  now,
  readOnly,
  onSendToRoute,
  onRemoveFromRoute,
  onOpenRoute,
  onDebtCapChange
}: Props) {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [tenureFilter, setTenureFilter] = useState<TenureFilter>("all");
  const [unitSearch, setUnitSearch] = useState("");
  const [paymentDaysFilter, setPaymentDaysFilter] = useState<PaymentDaysFilter>("all");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [installmentFilter, setInstallmentFilter] = useState<InstallmentFilter>("all");
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [capDraftByClient, setCapDraftByClient] = useState<Record<string, string>>({});
  const [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null);

  const priorityRows = useMemo(
    () => buildPriorityReceivables(rows, clients, payments, collectionStatusByClient, now),
    [clients, collectionStatusByClient, now, payments, rows]
  );

  const searchedUnit = normalizedUnitSearch(unitSearch);
  const unitRows = useMemo(
    () => searchedUnit
      ? priorityRows.filter((item) => normalizedUnitSearch(item.row.unitId).includes(searchedUnit))
      : priorityRows,
    [priorityRows, searchedUnit]
  );
  const activeFilters: PriorityFilterValues = {
    level: levelFilter,
    plan: planFilter,
    installments: installmentFilter,
    payment: paymentDaysFilter,
    tenure: tenureFilter
  };
  const levelFacetRows = unitRows.filter((item) => matchesPriorityFilters(item, now, activeFilters, "level"));
  const planFacetRows = unitRows.filter((item) => matchesPriorityFilters(item, now, activeFilters, "plan"));
  const installmentFacetRows = unitRows.filter((item) => matchesPriorityFilters(item, now, activeFilters, "installments"));
  const paymentFacetRows = unitRows.filter((item) => matchesPriorityFilters(item, now, activeFilters, "payment"));
  const tenureFacetRows = unitRows.filter((item) => matchesPriorityFilters(item, now, activeFilters, "tenure"));
  const visibleRows = unitRows.filter((item) => matchesPriorityFilters(item, now, activeFilters));

  const planOptions = PLAN_FILTER_OPTIONS.map((plan) => [
    plan,
    planFacetRows.filter((item) => item.row.plan === plan).length
  ] as const);
  const installmentOptions = (() => {
    const counts = new Map<number, number>();
    for (const item of installmentFacetRows) {
      const installments = priorityOverdueInstallmentCount(item.row.overdueBalance, item.row.rentAmount);
      if (installments > 0) counts.set(installments, (counts.get(installments) ?? 0) + 1);
    }
    if (installmentFilter !== "all" && !counts.has(Number(installmentFilter))) counts.set(Number(installmentFilter), 0);
    return [...counts.entries()].sort((left, right) => right[0] - left[0]);
  })();
  const paymentDayOptions = (() => {
    const counts = new Map<number, number>();
    let withoutPayments = 0;
    for (const item of paymentFacetRows) {
      const days = priorityPaymentDaysAgo(item.lastPayment, now);
      if (days === null) {
        withoutPayments += 1;
        continue;
      }
      counts.set(days, (counts.get(days) ?? 0) + 1);
    }
    if (paymentDaysFilter !== "all" && paymentDaysFilter !== "no_payments" && !counts.has(Number(paymentDaysFilter))) {
      counts.set(Number(paymentDaysFilter), 0);
    }
    return {
      withoutPayments,
      days: [...counts.entries()].sort((left, right) => right[0] - left[0])
    };
  })();
  const tenureOptions = (() => {
    const counts = new Map<PriorityTenureBucket, number>();
    for (const item of tenureFacetRows) {
      const bucket = priorityTenureBucket(item.tenureDays);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return TENURE_FILTER_OPTIONS
      .filter((option): option is { value: PriorityTenureBucket; label: string } => option.value !== "all")
      .map((option) => ({ ...option, count: counts.get(option.value) ?? 0 }))
      .filter((option) => option.count > 0 || option.value === tenureFilter);
  })();
  const counts = levelFacetRows.reduce<Record<LevelFilter, number>>((result, item) => {
    result.all += 1;
    result[item.level] += 1;
    return result;
  }, { all: 0, critical: 0, high: 0, medium: 0, low: 0 });
  const totalOverdue = visibleRows.reduce((sum, item) => sum + item.row.overdueBalance, 0);

  function openRoutePreparation(item: PriorityReceivable): void {
    setRouteDraft({
      item,
      amount: inputMoney(item.row.overdueBalance),
      routeAssignment: "",
      customRoute: false,
      managementType: "solo_cobrar",
      urgency: routeUrgencyForPriority(item.level),
      comment: ""
    });
  }

  function saveRoutePreparation(): void {
    if (!routeDraft) return;
    const releaseAmount = Number(routeDraft.amount);
    const routeAssignment = normalizedRoute(routeDraft.routeAssignment);
    if (!(releaseAmount > 0) || !routeAssignment) return;
    onSendToRoute({
      clientId: routeDraft.item.row.id,
      releaseAmount,
      routeAssignment,
      managementType: routeDraft.managementType,
      urgency: routeDraft.urgency,
      comment: routeDraft.comment.trim()
    });
    setRouteDraft(null);
  }

  function saveDebtCap(item: PriorityReceivable): void {
    const draft = capDraftByClient[item.row.id];
    if (draft === undefined) return;
    const parsed = Number(draft);
    onDebtCapChange(item.row.id, Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    setCapDraftByClient((current) => {
      const next = { ...current };
      delete next[item.row.id];
      return next;
    });
  }

  return (
    <div className="ar-priority">
      <div className="ar-priority-toolbar">
        <div className="ar-priority-filters">
          <div className="ar-priority-level-filters" aria-label="Filtrar nivel de peligro">
            {(["all", "critical", "high", "medium", "low"] as LevelFilter[]).map((level) => (
              <button
                key={level}
                type="button"
                className={levelFilter === level ? "is-active" : ""}
                aria-pressed={levelFilter === level}
                onClick={() => setLevelFilter(level)}
              >
                {level === "all" ? "Todos" : LEVEL_LABEL[level]} <strong>{counts[level]}</strong>
              </button>
            ))}
          </div>
          <div className="ar-priority-filter-fields">
            <label className="ar-priority-unit-filter">
              <span>Unidad</span>
              <input
                type="search"
                value={unitSearch}
                placeholder="Ej. B79"
                aria-label="Filtrar por unidad"
                onChange={(event) => setUnitSearch(event.target.value)}
              />
            </label>
            <label className="ar-priority-plan-filter">
              <span>Plan</span>
              <select value={planFilter} aria-label="Filtrar por tipo de plan" onChange={(event) => setPlanFilter(event.target.value as PlanFilter)}>
                <option value="all">Todos los planes ({planFacetRows.length})</option>
                {planOptions.map(([plan, count]) => <option key={plan} value={plan}>{PLAN_LABEL[plan]} ({count})</option>)}
              </select>
            </label>
            <label className="ar-priority-installments-filter">
              <span>Cuotas vencidas</span>
              <select value={installmentFilter} aria-label="Filtrar por cuotas vencidas" onChange={(event) => setInstallmentFilter(event.target.value as InstallmentFilter)}>
                <option value="all">Todas las cuotas ({installmentFacetRows.length})</option>
                {installmentOptions.map(([installments, count]) => (
                  <option key={installments} value={String(installments)}>
                    {installments} cuota{installments === 1 ? "" : "s"} ({count})
                  </option>
                ))}
              </select>
            </label>
            <label className="ar-priority-payment-days-filter">
              <span>Último pago</span>
              <select value={paymentDaysFilter} aria-label="Filtrar por días desde el último pago" onChange={(event) => setPaymentDaysFilter(event.target.value as PaymentDaysFilter)}>
                <option value="all">Todos los días ({paymentFacetRows.length})</option>
                {paymentDayOptions.withoutPayments > 0 || paymentDaysFilter === "no_payments"
                  ? <option value="no_payments">Sin pagos ({paymentDayOptions.withoutPayments})</option>
                  : null}
                {paymentDayOptions.days.map(([days, count]) => (
                  <option key={days} value={String(days)}>
                    {days === 0 ? "Hoy" : `${days} día${days === 1 ? "" : "s"}`} ({count})
                  </option>
                ))}
              </select>
            </label>
            <label className="ar-priority-tenure-filter">
              <span>Antigüedad</span>
              <select value={tenureFilter} aria-label="Filtrar por antigüedad" onChange={(event) => setTenureFilter(event.target.value as TenureFilter)}>
                <option value="all">Toda antigüedad ({tenureFacetRows.length})</option>
                {tenureOptions.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count})</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="ar-priority-summary">
          <span>{visibleRows.length} cliente{visibleRows.length === 1 ? "" : "s"}</span>
          <strong>{formatWholeCurrency(totalOverdue)} vencidos</strong>
        </div>
      </div>

      <p className="ar-priority-rule">
        Orden: cliente más nuevo, mayor renta vencida y mayor tiempo de atraso. Solo se incluye renta con vencimiento anterior a hoy.
      </p>

      <div className="ar-priority-list" aria-live="polite">
        {visibleRows.map((item) => {
          const row = item.row;
          const status = collectionStatusByClient[row.id];
          const isInRoute = status?.isRouteTagged === true;
          const isExpanded = expandedClientId === row.id;
          const capValue = capDraftByClient[row.id] ?? (item.debtCap ? inputMoney(item.debtCap) : "");
          const payment = paymentReading(item.lastPayment, now);
          const installmentSummary = summarizeInstallmentDebt(row.overdueBalance, row.rentAmount);
          return (
            <article key={row.id} className={`ar-priority-row ar-priority-row--${item.level}${isInRoute ? " is-in-route" : ""}`}>
              <div className="ar-priority-unit">
                <strong>{row.unitId}</strong>
                <span>{PLAN_LABEL[row.plan]}</span>
              </div>
              <div className="ar-priority-client">
                <div className="ar-priority-client-head">
                  <strong>{row.name}</strong>
                  <span className={`ar-priority-level ar-priority-level--${item.level}`}>{LEVEL_LABEL[item.level]}</span>
                </div>
                <div className="ar-priority-reading">
                  <div className={`ar-priority-marker ar-priority-marker--payment ar-priority-marker--${payment.tone}`}>
                    <span>Último pago</span>
                    <strong>{payment.elapsed}</strong>
                    {payment.detail ? <small>{payment.detail}</small> : null}
                  </div>
                  <div className="ar-priority-marker ar-priority-marker--debt">
                    <span>Renta vencida</span>
                    <strong>{formatWholeCurrency(row.overdueBalance)}</strong>
                    <small>
                      {installmentSummary?.installmentText ?? "Sin cuota calculada"}
                      {installmentSummary?.partialPaymentText ? ` · ${installmentSummary.partialPaymentText}` : ""}
                      {` · Desde ${shortDate(row.nextDueDate)}`}
                    </small>
                  </div>
                  <div className="ar-priority-marker ar-priority-marker--tenure">
                    <span>Antigüedad</span>
                    <strong>{formatCalendarDuration(item.tenureStart, now)}</strong>
                    <small>{item.isEstablishedClient ? "Cliente antiguo" : "Cliente nuevo"}</small>
                  </div>
                </div>
              </div>
              <div className="ar-priority-actions">
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => setExpandedClientId(isExpanded ? null : row.id)}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? "Ocultar" : "Ver detalle"}
                </button>
                {isInRoute ? (
                  <div className="ar-priority-route-actions">
                    <button type="button" className="button small ar-priority-route-done" onClick={onOpenRoute}>En ruta</button>
                    {!readOnly ? <button type="button" className="button ghost small" onClick={() => onRemoveFromRoute(row.id)}>Quitar</button> : null}
                  </div>
                ) : (
                  <button type="button" className="button primary small" onClick={() => openRoutePreparation(item)} disabled={readOnly}>Enviar a ruta</button>
                )}
              </div>
              {isExpanded ? (
                <div className="ar-priority-detail">
                  <p>{item.reason}</p>
                  <div className="ar-priority-detail-values">
                    <span><small>Renta vencida</small><strong>{formatWholeCurrency(row.overdueBalance)}</strong></span>
                    <span><small>Cuota</small><strong>{formatWholeCurrency(row.rentAmount)} · {PLAN_LABEL[row.plan]}</strong></span>
                    <span><small>Cuotas generadas</small><strong>{item.generatedInstallments}</strong></span>
                    <span><small>Atraso</small><strong>{row.daysLate} día{row.daysLate === 1 ? "" : "s"}</strong></span>
                    <label>
                      <small>Tope personal de renta vencida</small>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={capValue}
                        placeholder="Sin tope"
                        disabled={readOnly}
                        onChange={(event) => setCapDraftByClient((current) => ({ ...current, [row.id]: event.target.value }))}
                        onBlur={() => saveDebtCap(item)}
                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                      />
                    </label>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
        {visibleRows.length === 0 ? <div className="ar-priority-empty">No hay clientes con renta vencida para estos filtros.</div> : null}
      </div>

      {routeDraft ? (
        <div className="modal-overlay" onClick={() => setRouteDraft(null)}>
          <div className="modal ar-priority-route-modal" role="dialog" aria-modal="true" aria-labelledby="ar-priority-route-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><span className="ar-priority-modal-kicker">Preparación de cobro</span><h2 id="ar-priority-route-title">{routeDraft.item.row.unitId} · {routeDraft.item.row.name}</h2></div>
              <button type="button" className="modal-close" onClick={() => setRouteDraft(null)} aria-label="Cerrar">X</button>
            </div>
            <div className="modal-body">
              <p className="ar-priority-modal-rule"><strong>Monto prellenado:</strong> toda la renta vencida hasta ayer. Puedes editarlo; el cambio no modifica el saldo real del cliente.</p>
              <div className="ar-priority-route-grid">
                <label>Monto a cobrar
                  <input type="number" min="1" step="1" inputMode="numeric" value={routeDraft.amount} onChange={(event) => setRouteDraft((current) => current ? { ...current, amount: event.target.value } : current)} autoFocus />
                </label>
                <label>Ruta
                  {routeDraft.customRoute ? (
                    <input value={routeDraft.routeAssignment} maxLength={12} placeholder="Escribe la ruta" onChange={(event) => setRouteDraft((current) => current ? { ...current, routeAssignment: event.target.value.toUpperCase().slice(0, 12) } : current)} />
                  ) : (
                    <select value={routeDraft.routeAssignment} onChange={(event) => {
                      if (event.target.value === "__custom") {
                        setRouteDraft((current) => current ? { ...current, customRoute: true, routeAssignment: "" } : current);
                        return;
                      }
                      setRouteDraft((current) => current ? { ...current, routeAssignment: event.target.value } : current);
                    }}>
                      <option value="">Seleccionar ruta</option>
                      {ROUTE_ASSIGNMENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      <option value="__custom">Otra</option>
                    </select>
                  )}
                </label>
                <label>Tipo de gestión
                  <select value={routeDraft.managementType} onChange={(event) => setRouteDraft((current) => current ? { ...current, managementType: event.target.value as FieldManagementType } : current)}>
                    <option value="solo_cobrar">Solo cobrar</option>
                    <option value="cobrar_o_quitar">Cobrar o quitar</option>
                    <option value="desiste">Desiste</option>
                    <option value="quitar">Quitar</option>
                  </select>
                </label>
                <label>Urgencia
                  <select value={routeDraft.urgency} onChange={(event) => setRouteDraft((current) => current ? { ...current, urgency: event.target.value as RouteUrgency } : current)}>
                    {ROUTE_URGENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="ar-priority-route-comment">Comentario para el cobrador
                  <textarea maxLength={25} rows={2} value={routeDraft.comment} onChange={(event) => setRouteDraft((current) => current ? { ...current, comment: event.target.value } : current)} />
                </label>
              </div>
            </div>
            <div className="ar-priority-modal-actions">
              <span>{!(Number(routeDraft.amount) > 0) ? "El monto debe ser mayor que cero." : !normalizedRoute(routeDraft.routeAssignment) ? "Falta seleccionar la ruta." : "Lista para enviar automáticamente a Ruta en calle."}</span>
              <div><button type="button" className="button ghost" onClick={() => setRouteDraft(null)}>Cancelar</button><button type="button" className="button primary" disabled={!(Number(routeDraft.amount) > 0) || !normalizedRoute(routeDraft.routeAssignment)} onClick={saveRoutePreparation}>Listo</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
