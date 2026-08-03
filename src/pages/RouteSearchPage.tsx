import { useEffect, useMemo, useState } from "react";
import {
  ALL_ACTIVE_ROUTE_FILTER,
  activeRouteFilterLabel,
  activeRouteFilterValue,
  compareActiveRouteFilterValues,
  compareActiveRouteItems
} from "../activeRouteOrdering";
import { loadCloudActiveRouteItems, type ActiveRouteItem } from "../cloudData";
import { formatCurrency, formatDate } from "../format";
import { supabase } from "../lib/supabase";
import type { Payment } from "../types";

type Props = {
  dataOwnerUserId?: string | null;
  payments: Payment[];
};

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKeyFromTimestampValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function paymentReleasesRoute(payment: Payment, item: ActiveRouteItem): boolean {
  if (payment.clientId !== item.clientId || payment.amountReceived < item.releaseAmount) return false;
  const routeStartedAt = toTimestamp(item.routeStartedAt);
  const createdTimestamp = toTimestamp(payment.createdAt);
  if (createdTimestamp > 0 && routeStartedAt > 0) return createdTimestamp >= routeStartedAt;
  const routeDateKey = dateKeyFromTimestampValue(item.routeStartedAt);
  return !!routeDateKey && payment.dateApplied >= routeDateKey;
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${formatDate(date)} ${date.toLocaleTimeString("es-PA", { hour: "numeric", minute: "2-digit" })}`;
}

export default function RouteSearchPage({ dataOwnerUserId, payments }: Props) {
  const [items, setItems] = useState<ActiveRouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [routeFilter, setRouteFilter] = useState(ALL_ACTIVE_ROUTE_FILTER);
  const [lastRefreshAt, setLastRefreshAt] = useState("");

  async function reload(): Promise<void> {
    if (!dataOwnerUserId) {
      setItems([]);
      setLoading(false);
      setError("No hay dataset asignado para consultar la ruta.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextItems = await loadCloudActiveRouteItems(dataOwnerUserId);
      setItems(nextItems);
      setLastRefreshAt(new Date().toLocaleTimeString("es-PA", { hour: "numeric", minute: "2-digit" }));
    } catch (loadError) {
      console.error("No se pudo cargar la vista buscador.", loadError);
      setError("No se pudo cargar Cobro en Ruta.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    const channel = client
      .channel(`route-search-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_route_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reload();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

  const activeItems = useMemo(() => (
    items
      .filter((item) => !item.removedAt)
      .filter((item) => !payments.some((payment) => paymentReleasesRoute(payment, item)))
  ), [items, payments]);

  const routeFilterOptions = useMemo(() => (
    Array.from(new Set(activeItems.map((item) => activeRouteFilterValue(item.routeAssignment))))
      .sort(compareActiveRouteFilterValues)
  ), [activeItems]);

  useEffect(() => {
    if (routeFilter !== ALL_ACTIVE_ROUTE_FILTER && !routeFilterOptions.includes(routeFilter)) {
      setRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
    }
  }, [routeFilter, routeFilterOptions]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activeItems
      .filter((item) => routeFilter === ALL_ACTIVE_ROUTE_FILTER || activeRouteFilterValue(item.routeAssignment) === routeFilter)
      .filter((item) => {
        if (!normalizedQuery) return true;
        return [
          item.unitId,
          item.clientName,
          item.clientCedula ?? "",
          item.whatsAppPhone ?? "",
          item.routeAssignment ?? "",
          item.comment ?? ""
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort(compareActiveRouteItems);
  }, [activeItems, query, routeFilter]);

  const publishedAt = useMemo(() => {
    const timestamps = items.map((item) => toTimestamp(item.publishedAt)).filter((value) => value > 0);
    if (timestamps.length === 0) return "";
    return formatPublishedAt(new Date(Math.max(...timestamps)).toISOString());
  }, [items]);

  return (
    <section className="route-search-page">
      <header className="route-search-header">
        <div>
          <h1>Cobro en Ruta</h1>
          <p>{visibleItems.length} activo{visibleItems.length === 1 ? "" : "s"}{publishedAt ? ` | Publicada ${publishedAt}` : ""}</p>
        </div>
        <button type="button" className="button ghost small" onClick={() => void reload()} disabled={loading}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </header>

      <label className="route-search-box">
        <span>Buscar</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Unidad, cliente, cedula, telefono..."
          autoComplete="off"
        />
      </label>

      {lastRefreshAt ? <p className="route-search-refresh">Ultima actualizacion: {lastRefreshAt}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {routeFilterOptions.length > 0 ? (
        <div className="route-search-filters" aria-label="Filtrar por ruta">
          <button
            type="button"
            className={routeFilter === ALL_ACTIVE_ROUTE_FILTER ? "is-active" : ""}
            onClick={() => setRouteFilter(ALL_ACTIVE_ROUTE_FILTER)}
          >
            Todas
          </button>
          {routeFilterOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={routeFilter === option ? "is-active" : ""}
              onClick={() => setRouteFilter(option)}
            >
              {activeRouteFilterLabel(option)}
            </button>
          ))}
        </div>
      ) : null}

      {loading && visibleItems.length === 0 ? (
        <div className="route-search-empty">Cargando ruta...</div>
      ) : visibleItems.length === 0 ? (
        <div className="route-search-empty">No hay clientes activos en Cobro en Ruta.</div>
      ) : (
        <div className="route-search-list">
          {visibleItems.map((item) => {
            const managementTone = item.managementType === "cobrar_o_quitar" ? "remove" : "collect";
            return (
              <article className={`route-search-card route-search-card--${managementTone} ${item.urgency && item.urgency !== "normal" ? `route-search-card--${item.urgency}` : ""}`} key={item.clientId}>
                <div className="route-search-card-head">
                  <div>
                    <strong>{item.unitId}</strong>
                    <span>{firstName(item.clientName)}</span>
                  </div>
                  <span className="route-search-route">{item.routeAssignment || "Sin ruta"}</span>
                </div>
                {item.urgency && item.urgency !== "normal" ? (
                  <div className={`route-search-alarm route-search-alarm--${item.urgency}`}>
                    {item.urgency === "very_urgent" ? "Muy urgente" : "Urgente"}
                  </div>
                ) : null}
                <div className="route-search-amounts">
                  <div className="route-search-release-amount">
                    <small>Min. liberar</small>
                    <strong>{formatCurrency(item.releaseAmount)}</strong>
                  </div>
                  <div className="route-search-overdue-amount">
                    <small>Vencido</small>
                    <strong>{formatCurrency(item.overdueBalance)}</strong>
                  </div>
                </div>
                <div className="route-search-meta">
                  <span className={`route-search-delay ${item.daysLate > 0 ? "route-search-delay--late" : "route-search-delay--ok"}`}>
                    {item.daysLate > 0 ? `${item.daysLate} dias atraso` : "Sin atraso"}
                  </span>
                  <span className={`route-search-management route-search-management--${managementTone}`}>
                    {item.managementType === "cobrar_o_quitar" ? "Cobrar o quitar" : "Solo cobrar"}
                  </span>
                  <span className="route-search-added-at">En calle {formatPublishedAt(item.publishedAt)}</span>
                  {item.whatsAppPhone ? <a className="route-search-phone" href={`tel:${item.whatsAppPhone}`}>{item.whatsAppPhone}</a> : null}
                </div>
                {item.comment ? <p className="route-search-comment">{item.comment}</p> : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
