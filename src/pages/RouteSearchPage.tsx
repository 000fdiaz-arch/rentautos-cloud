import { useEffect, useMemo, useRef, useState } from "react";
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

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("No se pudo crear la imagen."));
    }, "image/jpeg", 0.94);
  });
}

function routeImageFileName(routeLabel: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const route = routeLabel
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `cobro-en-ruta-${route || "sin-ruta"}-${date}.jpg`;
}

export default function RouteSearchPage({ dataOwnerUserId, payments }: Props) {
  const [items, setItems] = useState<ActiveRouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [routeFilter, setRouteFilter] = useState(ALL_ACTIVE_ROUTE_FILTER);
  const [lastRefreshAt, setLastRefreshAt] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const shareSheetRefs = useRef(new Map<string, HTMLDivElement>());

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

  const visibleRouteGroups = useMemo(() => {
    const groups = new Map<string, ActiveRouteItem[]>();
    visibleItems.forEach((item) => {
      const routeValue = activeRouteFilterValue(item.routeAssignment);
      const current = groups.get(routeValue) ?? [];
      current.push(item);
      groups.set(routeValue, current);
    });
    return Array.from(groups.entries())
      .sort(([left], [right]) => compareActiveRouteFilterValues(left, right))
      .map(([routeValue, routeItems]) => ({
        routeValue,
        routeLabel: activeRouteFilterLabel(routeValue),
        items: routeItems
      }));
  }, [visibleItems]);

  async function shareRouteImage(): Promise<void> {
    if (visibleRouteGroups.length === 0 || sharing) return;
    setSharing(true);
    setShareMessage("");
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const { default: html2canvas } = await import("html2canvas");
      const generatedImages: Array<{ blob: Blob; file: File }> = [];
      for (const group of visibleRouteGroups) {
        const shareSheet = shareSheetRefs.current.get(group.routeValue);
        if (!shareSheet) throw new Error(`No se encontro la hoja de ${group.routeLabel}.`);
        const canvas = await html2canvas(shareSheet, {
          backgroundColor: "#f4f7fb",
          scale: 1.5,
          useCORS: true,
          logging: false
        });
        const blob = await canvasToJpegBlob(canvas);
        const fileName = routeImageFileName(group.routeLabel);
        generatedImages.push({ blob, file: new File([blob], fileName, { type: "image/jpeg" }) });
      }
      const files = generatedImages.map(({ file }) => file);
      const caption = visibleRouteGroups
        .map((group) => `Ruta ${group.routeLabel} · ${group.items.length} cliente${group.items.length === 1 ? "" : "s"}`)
        .join("\n");
      const shareData: ShareData = {
        title: "Cobro en Ruta",
        text: caption,
        files
      };

      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files }))) {
        try {
          await navigator.share(shareData);
          setShareMessage(`${files.length === 1 ? "Imagen compartida" : `${files.length} imagenes compartidas`} por ruta.`);
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
          console.warn("No se pudo abrir el menu de compartir; se descargara la imagen.", shareError);
        }
      }

      generatedImages.forEach(({ blob, file }, index) => {
        const url = URL.createObjectURL(blob);
        window.setTimeout(() => {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = file.name;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        }, index * 150);
      });
      let captionCopied = false;
      try {
        await navigator.clipboard.writeText(caption);
        captionCopied = true;
      } catch (clipboardError) {
        console.warn("No se pudo copiar la leyenda de las rutas.", clipboardError);
      }
      setShareMessage(
        `${files.length === 1 ? "Imagen descargada" : `${files.length} imagenes descargadas`}.` +
        (captionCopied ? " La leyenda quedo copiada para pegarla en WhatsApp." : " Ya puedes enviarlas por WhatsApp.")
      );
    } catch (shareError) {
      console.error("No se pudo generar la imagen de Cobro en Ruta.", shareError);
      setShareMessage("No se pudo generar la imagen. Intenta nuevamente.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="route-search-page">
      <header className="route-search-header">
        <div>
          <h1>Cobro en Ruta</h1>
          <p>{visibleItems.length} activo{visibleItems.length === 1 ? "" : "s"}{publishedAt ? ` | Publicada ${publishedAt}` : ""}</p>
        </div>
        <div className="route-search-header-actions">
          <button
            type="button"
            className="button primary small route-search-share-button"
            onClick={() => void shareRouteImage()}
            disabled={loading || sharing || visibleItems.length === 0}
          >
            {sharing ? "Creando fotos..." : "Compartir por ruta"}
          </button>
          <button type="button" className="button ghost small" onClick={() => void reload()} disabled={loading || sharing}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
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
      {shareMessage ? <p className="route-search-share-message" role="status">{shareMessage}</p> : null}
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

      <div className="route-share-stage" aria-hidden="true">
        {visibleRouteGroups.map((group) => (
          <div
            className="route-share-sheet"
            key={group.routeValue}
            ref={(element) => {
              if (element) shareSheetRefs.current.set(group.routeValue, element);
              else shareSheetRefs.current.delete(group.routeValue);
            }}
          >
            <header className="route-share-sheet-header">
              <div>
                <span className="route-share-eyebrow">RENT AUTOS</span>
                <h2>Cobro en Ruta</h2>
                <p>Ruta {group.routeLabel}</p>
              </div>
              <div className="route-share-summary">
                <strong>{group.items.length}</strong>
                <span>cliente{group.items.length === 1 ? "" : "s"}</span>
              </div>
            </header>
            <div className="route-share-meta-line">
              <span>Generada {formatPublishedAt(new Date().toISOString())}</span>
              {publishedAt ? <span>Ruta publicada {publishedAt}</span> : null}
            </div>
            <div className="route-share-grid">
              {group.items.map((item) => {
                const managementTone = item.managementType === "cobrar_o_quitar" ? "remove" : "collect";
                return (
                  <article className={`route-share-card route-share-card--${managementTone} ${item.urgency && item.urgency !== "normal" ? `route-share-card--${item.urgency}` : ""}`} key={item.clientId}>
                  <div className="route-share-card-title">
                    <div>
                      <strong>{item.unitId}</strong>
                      <span>{item.clientName}</span>
                    </div>
                    <b>{item.routeAssignment || "Sin ruta"}</b>
                  </div>
                  <div className="route-share-card-amounts">
                    <div>
                      <small>Min. liberar</small>
                      <strong>{formatCurrency(item.releaseAmount)}</strong>
                    </div>
                    <div>
                      <small>Vencido</small>
                      <strong>{formatCurrency(item.overdueBalance)}</strong>
                    </div>
                  </div>
                  <div className="route-share-tags">
                    <span>{item.daysLate > 0 ? `${item.daysLate} dias de atraso` : "Sin atraso"}</span>
                    <span>{item.managementType === "cobrar_o_quitar" ? "Cobrar o quitar" : "Solo cobrar"}</span>
                    {item.urgency && item.urgency !== "normal" ? (
                      <span>{item.urgency === "very_urgent" ? "Muy urgente" : "Urgente"}</span>
                    ) : null}
                    {item.whatsAppPhone ? <span>Tel. {item.whatsAppPhone}</span> : null}
                  </div>
                  {item.comment ? <p>{item.comment}</p> : null}
                  </article>
                );
              })}
            </div>
            <footer>Ruta {group.routeLabel} · {group.items.length} cliente{group.items.length === 1 ? "" : "s"}</footer>
          </div>
        ))}
      </div>
    </section>
  );
}
