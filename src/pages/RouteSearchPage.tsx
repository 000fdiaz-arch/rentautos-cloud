import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_ACTIVE_ROUTE_FILTER,
  activeRouteFilterLabel,
  activeRouteFilterValue,
  compareActiveRouteFilterValues,
  compareActiveRouteItems
} from "../activeRouteOrdering";
import { getBusinessDateKey } from "../billing";
import { buildCloudErrorMessage } from "../app/appShellRules";
import { loadCloudActiveRouteItems, saveCloudActiveRouteZone, type ActiveRouteItem } from "../cloudData";
import { formatCurrency, formatDate } from "../format";
import { supabase } from "../lib/supabase";
import type { CollectionTeam, Payment } from "../types";
import { loadNotifiedPayments, parseNotifiedPayments } from "./payments/paymentStorage";
import type { NotifiedPayment } from "./payments/paymentTypes";
import { fieldManagementLabel, type FieldManagementType } from "./receivables/receivablesTypes";

type Props = {
  dataOwnerUserId?: string | null;
  payments: Payment[];
  readOnly?: boolean;
  onRegisterPayment?: (input: {
    clientId: string;
    amount: number;
    method: "cash" | "bank";
    team: CollectionTeam;
  }) => Promise<{ kind: "cash" | "bank"; receiptNumber?: string }>;
};

const ALL_ACTIVE_ZONE_FILTER = "__all_zones__";
const EMPTY_ACTIVE_ZONE_FILTER = "__empty_zone__";

type ZoneOption = {
  value: string;
  label: string;
  count: number;
};

function normalizeZoneName(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function activeZoneFilterValue(value: string | undefined): string {
  const normalized = normalizeZoneName(value);
  return normalized ? normalized.toLocaleLowerCase("es") : EMPTY_ACTIVE_ZONE_FILTER;
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function routeRentAmountForDay(payments: Payment[], item: ActiveRouteItem, dateKey: string): number {
  const total = payments
    .filter((payment) => payment.clientId === item.clientId && payment.dateApplied === dateKey)
    .reduce((sum, payment) => sum + Math.max(0, payment.appliedToRent), 0);
  return Math.round(total * 100) / 100;
}

function hasPartialRoutePayment(payments: Payment[], item: ActiveRouteItem, dateKey: string): boolean {
  const confirmedRentAmount = routeRentAmountForDay(payments, item, dateKey);
  return confirmedRentAmount > 0 && confirmedRentAmount < item.releaseAmount;
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

function managementTone(value: FieldManagementType | undefined): "collect" | "remove" | "desist" | "seize" {
  if (value === "cobrar_o_quitar") return "remove";
  if (value === "desiste") return "desist";
  if (value === "quitar") return "seize";
  return "collect";
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

function routeImageFileName(routeLabel: string, zoneLabel?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const route = `${routeLabel}${zoneLabel ? `-${zoneLabel}` : ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `cobro-en-ruta-${route || "sin-ruta"}-${date}.jpg`;
}

export default function RouteSearchPage({ dataOwnerUserId, payments, readOnly = true, onRegisterPayment }: Props) {
  const businessDateKey = getBusinessDateKey();
  const [items, setItems] = useState<ActiveRouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [routeFilter, setRouteFilter] = useState(ALL_ACTIVE_ROUTE_FILTER);
  const [zoneFilter, setZoneFilter] = useState(ALL_ACTIVE_ZONE_FILTER);
  const [zoneFilterLabel, setZoneFilterLabel] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "partial">("all");
  const [zoneDrafts, setZoneDrafts] = useState<Record<string, string>>({});
  const [zoneSavingByClient, setZoneSavingByClient] = useState<Record<string, boolean>>({});
  const [zoneError, setZoneError] = useState("");
  const [lastRefreshAt, setLastRefreshAt] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [bankNotices, setBankNotices] = useState<NotifiedPayment[]>(() => loadNotifiedPayments());
  const [paymentTarget, setPaymentTarget] = useState<ActiveRouteItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("cash");
  const [paymentTeam, setPaymentTeam] = useState<"" | CollectionTeam>("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
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

  async function reloadBankNotices(): Promise<void> {
    if (!dataOwnerUserId || !supabase) {
      setBankNotices(loadNotifiedPayments());
      return;
    }
    const { data, error: noticesError } = await supabase
      .from("notified_payments_cloud")
      .select("data")
      .eq("user_id", dataOwnerUserId);
    if (noticesError) {
      console.warn("No se pudieron actualizar los pagos bancarios en hold.", noticesError);
      setBankNotices(loadNotifiedPayments());
      return;
    }
    setBankNotices(parseNotifiedPayments((data ?? []).map((row) => row.data)));
  }

  useEffect(() => {
    void reload();
    void reloadBankNotices();
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    const channel = client
      .channel(`route-search-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_route_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reload();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notified_payments_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reloadBankNotices();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

  const activeItems = useMemo(() => (
    items
      .filter((item) => !item.removedAt)
      .filter((item) => item.releaseAmount <= 0 || routeRentAmountForDay(payments, item, businessDateKey) < item.releaseAmount)
  ), [businessDateKey, items, payments]);

  const bankNoticesByClient = useMemo(() => {
    const grouped = new Map<string, NotifiedPayment[]>();
    bankNotices.filter((notice) => notice.paymentMethod === "bank").forEach((notice) => {
      grouped.set(notice.clientId, [...(grouped.get(notice.clientId) ?? []), notice]);
    });
    return grouped;
  }, [bankNotices]);

  const routeFilterOptions = useMemo(() => (
    Array.from(new Set(activeItems.map((item) => activeRouteFilterValue(item.routeAssignment))))
      .sort(compareActiveRouteFilterValues)
  ), [activeItems]);

  const zoneOptionsByRoute = useMemo(() => {
    const byRoute = new Map<string, Map<string, ZoneOption>>();
    activeItems.forEach((item) => {
      const routeValue = activeRouteFilterValue(item.routeAssignment);
      const zoneValue = activeZoneFilterValue(item.zone);
      const routeZones = byRoute.get(routeValue) ?? new Map<string, ZoneOption>();
      const current = routeZones.get(zoneValue);
      routeZones.set(zoneValue, {
        value: zoneValue,
        label: zoneValue === EMPTY_ACTIVE_ZONE_FILTER ? "Sin zona" : (current?.label ?? normalizeZoneName(item.zone)),
        count: (current?.count ?? 0) + 1
      });
      byRoute.set(routeValue, routeZones);
    });
    return new Map(Array.from(byRoute.entries()).map(([routeValue, zones]) => [
      routeValue,
      Array.from(zones.values()).sort((left, right) => {
        if (left.value === EMPTY_ACTIVE_ZONE_FILTER) return -1;
        if (right.value === EMPTY_ACTIVE_ZONE_FILTER) return 1;
        return left.label.localeCompare(right.label, "es", { numeric: true, sensitivity: "base" });
      })
    ]));
  }, [activeItems]);

  const selectedRouteItems = useMemo(() => (
    routeFilter === ALL_ACTIVE_ROUTE_FILTER
      ? []
      : activeItems.filter((item) => activeRouteFilterValue(item.routeAssignment) === routeFilter)
  ), [activeItems, routeFilter]);

  const zoneFilterOptions = useMemo(() => {
    if (routeFilter === ALL_ACTIVE_ROUTE_FILTER) return [];
    let options = zoneOptionsByRoute.get(routeFilter) ?? [];
    options = options.some((option) => option.value === EMPTY_ACTIVE_ZONE_FILTER)
      ? options
      : [{ value: EMPTY_ACTIVE_ZONE_FILTER, label: "Sin zona", count: 0 }, ...options];
    if (zoneFilter !== ALL_ACTIVE_ZONE_FILTER && !options.some((option) => option.value === zoneFilter)) {
      options = [...options, { value: zoneFilter, label: zoneFilterLabel || zoneFilter, count: 0 }];
    }
    return options;
  }, [routeFilter, zoneFilter, zoneFilterLabel, zoneOptionsByRoute]);

  useEffect(() => {
    if (routeFilter !== ALL_ACTIVE_ROUTE_FILTER && !routeFilterOptions.includes(routeFilter)) {
      setRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
    }
  }, [routeFilter, routeFilterOptions]);

  useEffect(() => {
    if (routeFilter === ALL_ACTIVE_ROUTE_FILTER) {
      setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
      setZoneFilterLabel("");
    }
  }, [routeFilter]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activeItems
      .filter((item) => routeFilter === ALL_ACTIVE_ROUTE_FILTER || activeRouteFilterValue(item.routeAssignment) === routeFilter)
      .filter((item) => zoneFilter === ALL_ACTIVE_ZONE_FILTER || activeZoneFilterValue(item.zone) === zoneFilter)
      .filter((item) => paymentFilter === "all" || hasPartialRoutePayment(payments, item, businessDateKey))
      .filter((item) => {
        if (!normalizedQuery) return true;
        return [
          item.unitId,
          item.clientName,
          item.clientCedula ?? "",
          item.whatsAppPhone ?? "",
          item.routeAssignment ?? "",
          item.zone ?? "",
          item.comment ?? ""
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort(compareActiveRouteItems);
  }, [activeItems, businessDateKey, payments, paymentFilter, query, routeFilter, zoneFilter]);

  const partialPaymentCount = useMemo(
    () => activeItems.filter((item) => hasPartialRoutePayment(payments, item, businessDateKey)).length,
    [activeItems, businessDateKey, payments]
  );

  const selectedZoneLabel = useMemo(() => {
    if (zoneFilter === ALL_ACTIVE_ZONE_FILTER) return "";
    return zoneFilterOptions.find((option) => option.value === zoneFilter)?.label ?? zoneFilterLabel;
  }, [zoneFilter, zoneFilterLabel, zoneFilterOptions]);

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
        zoneLabel: selectedZoneLabel,
        items: routeItems
      }));
  }, [selectedZoneLabel, visibleItems]);

  async function commitZone(item: ActiveRouteItem): Promise<void> {
    const draft = zoneDrafts[item.clientId];
    if (draft === undefined || zoneSavingByClient[item.clientId] || !dataOwnerUserId) return;
    const normalizedDraft = normalizeZoneName(draft);
    const routeZones = zoneOptionsByRoute.get(activeRouteFilterValue(item.routeAssignment)) ?? [];
    const matchingZone = routeZones.find((option) => (
      option.value !== EMPTY_ACTIVE_ZONE_FILTER && option.value === activeZoneFilterValue(normalizedDraft)
    ));
    const nextZone = normalizedDraft ? (matchingZone?.label ?? normalizedDraft) : undefined;
    const previousZone = item.zone;
    setZoneDrafts((current) => {
      const next = { ...current };
      delete next[item.clientId];
      return next;
    });
    if (activeZoneFilterValue(previousZone) === activeZoneFilterValue(nextZone)) return;

    setZoneError("");
    setZoneSavingByClient((current) => ({ ...current, [item.clientId]: true }));
    setItems((current) => current.map((currentItem) => (
      currentItem.clientId === item.clientId ? { ...currentItem, zone: nextZone } : currentItem
    )));
    try {
      await saveCloudActiveRouteZone({
        userId: dataOwnerUserId,
        clientId: item.clientId,
        routeAssignment: item.routeAssignment,
        zone: nextZone
      });
    } catch (saveError) {
      console.error("No se pudo guardar la zona de Ruta en calle.", saveError);
      setItems((current) => current.map((currentItem) => (
        currentItem.clientId === item.clientId ? { ...currentItem, zone: previousZone } : currentItem
      )));
      setZoneError("No se pudo guardar la zona. Se restauro el valor anterior.");
      void reload();
    } finally {
      setZoneSavingByClient((current) => ({ ...current, [item.clientId]: false }));
    }
  }

  function openPaymentDialog(item: ActiveRouteItem): void {
    setPaymentTarget(item);
    setPaymentAmount(item.releaseAmount > 0 ? String(item.releaseAmount) : "");
    setPaymentMethod("cash");
    setPaymentTeam("");
    setPaymentError("");
  }

  async function submitRoutePayment(): Promise<void> {
    if (!paymentTarget || !onRegisterPayment || paymentSaving) return;
    const amount = Number.parseFloat(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Indica un monto mayor a cero.");
      return;
    }
    if (!paymentTeam) {
      setPaymentError("Selecciona el equipo PTY o WC.");
      return;
    }
    setPaymentSaving(true);
    setPaymentError("");
    try {
      const result = await onRegisterPayment({
        clientId: paymentTarget.clientId,
        amount,
        method: paymentMethod,
        team: paymentTeam
      });
      if (result.kind === "bank") {
        setBankNotices(loadNotifiedPayments());
        setPaymentMessage(`Pago bancario de ${formatCurrency(amount)} en hold · Equipo ${paymentTeam}.`);
      } else {
        setPaymentMessage(`Pago en efectivo registrado en ${result.receiptNumber ?? "recibo"} · pendiente de entrega.`);
      }
      setPaymentTarget(null);
    } catch (saveError) {
      console.error("No se pudo registrar el pago desde Ruta en calle.", saveError);
      setPaymentError(buildCloudErrorMessage("No se pudo registrar el pago.", saveError, { includeRawFallback: true }));
    } finally {
      setPaymentSaving(false);
    }
  }

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
        const fileName = routeImageFileName(group.routeLabel, group.zoneLabel);
        generatedImages.push({ blob, file: new File([blob], fileName, { type: "image/jpeg" }) });
      }
      const files = generatedImages.map(({ file }) => file);
      const caption = visibleRouteGroups
        .map((group) => `Ruta ${group.routeLabel}${group.zoneLabel ? ` · Zona ${group.zoneLabel}` : ""} · ${group.items.length} cliente${group.items.length === 1 ? "" : "s"}`)
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
          placeholder="Unidad, cliente, cedula, telefono o zona..."
          autoComplete="off"
        />
      </label>

      {lastRefreshAt ? <p className="route-search-refresh">Ultima actualizacion: {lastRefreshAt}</p> : null}
      <div className="route-search-filter-block route-search-payment-filter-block">
        <span className="route-search-filter-label">Estado de pago</span>
        <div className="route-search-filters" aria-label="Filtrar por estado de pago">
          <button type="button" className={paymentFilter === "all" ? "is-active" : ""} onClick={() => setPaymentFilter("all")}>Todos</button>
          <button type="button" className={paymentFilter === "partial" ? "is-active" : ""} onClick={() => setPaymentFilter("partial")}>
            Pagos parciales ({partialPaymentCount})
          </button>
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {zoneError ? <p className="error-text" role="alert">{zoneError}</p> : null}
      {shareMessage ? <p className="route-search-share-message" role="status">{shareMessage}</p> : null}
      {paymentMessage ? <p className="route-search-payment-message" role="status">{paymentMessage}</p> : null}
      {routeFilterOptions.length > 0 ? (
        <div className="route-search-filter-block">
          <span className="route-search-filter-label">Ruta</span>
          <div className="route-search-filters" aria-label="Filtrar por ruta">
            <button
              type="button"
              className={routeFilter === ALL_ACTIVE_ROUTE_FILTER ? "is-active" : ""}
              onClick={() => {
                setRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
                setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
                setZoneFilterLabel("");
              }}
            >
              Todas
            </button>
            {routeFilterOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={routeFilter === option ? "is-active" : ""}
                onClick={() => {
                  setRouteFilter(option);
                  setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
                  setZoneFilterLabel("");
                }}
              >
                {activeRouteFilterLabel(option)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {routeFilter !== ALL_ACTIVE_ROUTE_FILTER ? (
        <div className="route-search-filter-block route-search-zone-filter-block">
          <span className="route-search-filter-label">Zona</span>
          <div className="route-search-filters route-search-zone-filters" aria-label="Filtrar por zona">
            <button
              type="button"
              className={zoneFilter === ALL_ACTIVE_ZONE_FILTER ? "is-active" : ""}
              onClick={() => {
                setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
                setZoneFilterLabel("");
              }}
            >
              Todas ({selectedRouteItems.length})
            </button>
            {zoneFilterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={zoneFilter === option.value ? "is-active" : ""}
                onClick={() => {
                  setZoneFilter(option.value);
                  setZoneFilterLabel(option.label);
                }}
              >
                {option.label} ({option.count})
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loading && visibleItems.length === 0 ? (
        <div className="route-search-empty">Cargando ruta...</div>
      ) : visibleItems.length === 0 ? (
        <div className="route-search-empty">No hay clientes activos en Cobro en Ruta.</div>
      ) : (
        <div className="route-search-list">
          {visibleItems.map((item, itemIndex) => {
            const itemManagementTone = managementTone(item.managementType);
            const confirmedRentAmount = routeRentAmountForDay(payments, item, businessDateKey);
            const remainingToRelease = Math.max(0, item.releaseAmount - confirmedRentAmount);
            const itemBankNotices = bankNoticesByClient.get(item.clientId) ?? [];
            const itemZoneOptions = (zoneOptionsByRoute.get(activeRouteFilterValue(item.routeAssignment)) ?? [])
              .filter((option) => option.value !== EMPTY_ACTIVE_ZONE_FILTER);
            const zoneListId = `route-zone-options-${itemIndex}`;
            return (
              <article className={`route-search-card route-search-card--${itemManagementTone} ${item.urgency && item.urgency !== "normal" ? `route-search-card--${item.urgency}` : ""}`} key={item.clientId}>
                <div className="route-search-card-head">
                  <div>
                    <strong>{item.unitId}</strong>
                    <span>{firstName(item.clientName)}</span>
                  </div>
                  <span className="route-search-route">{item.routeAssignment || "Sin ruta"}</span>
                </div>
                <label className="route-search-zone-field">
                  <span>Zona</span>
                  <div>
                    <input
                      type="text"
                      value={zoneDrafts[item.clientId] ?? item.zone ?? ""}
                      onChange={(event) => {
                        setZoneError("");
                        setZoneDrafts((current) => ({ ...current, [item.clientId]: event.target.value }));
                      }}
                      onBlur={() => void commitZone(item)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        event.currentTarget.blur();
                      }}
                      list={zoneListId}
                      maxLength={40}
                      placeholder="Sin zona"
                      autoComplete="off"
                      disabled={zoneSavingByClient[item.clientId] || !dataOwnerUserId}
                      aria-label={`Zona de ${item.unitId}`}
                    />
                    <span className="route-search-zone-status" aria-live="polite">
                      {zoneSavingByClient[item.clientId] ? "Guardando..." : ""}
                    </span>
                  </div>
                  <datalist id={zoneListId}>
                    {itemZoneOptions.map((option) => <option value={option.label} key={option.value} />)}
                  </datalist>
                </label>
                {item.urgency && item.urgency !== "normal" ? (
                  <div className={`route-search-alarm route-search-alarm--${item.urgency}`}>
                    {item.urgency === "very_urgent" ? "Muy urgente" : "Urgente"}
                  </div>
                ) : null}
                <div className="route-search-amounts">
                  <div className="route-search-release-amount">
                    <small>Min. liberar</small>
                    <strong>{item.releaseAmount > 0 ? formatCurrency(item.releaseAmount) : "Monto pendiente"}</strong>
                  </div>
                  <div className="route-search-overdue-amount">
                    <small>Vencido</small>
                    <strong>{formatCurrency(item.overdueBalance)}</strong>
                  </div>
                </div>
                {confirmedRentAmount > 0 && remainingToRelease > 0 ? (
                  <div className="route-search-payment-alert route-search-payment-alert--partial">
                    Pago parcial aplicado a renta: {formatCurrency(confirmedRentAmount)} · Faltan {formatCurrency(remainingToRelease)}
                  </div>
                ) : null}
                {itemBankNotices.map((notice) => (
                  <div className="route-search-payment-alert route-search-payment-alert--hold" key={notice.id}>
                    Por confirmar banca: {formatCurrency(notice.amount)}{notice.collectionTeam ? ` · Equipo ${notice.collectionTeam}` : ""}
                  </div>
                ))}
                <div className="route-search-meta">
                  <span className={`route-search-delay ${item.daysLate > 0 ? "route-search-delay--late" : "route-search-delay--ok"}`}>
                    {item.daysLate > 0 ? `${item.daysLate} dias atraso` : "Sin atraso"}
                  </span>
                  <span className={`route-search-management route-search-management--${itemManagementTone}`}>
                    {fieldManagementLabel(item.managementType)}
                  </span>
                  <span className="route-search-added-at">En calle {formatPublishedAt(item.publishedAt)}</span>
                </div>
                {item.comment ? <p className="route-search-comment">{item.comment}</p> : null}
                {!readOnly && onRegisterPayment ? (
                  <button type="button" className="button primary route-search-payment-button" onClick={() => openPaymentDialog(item)}>
                    Registrar pago
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {paymentTarget ? (
        <div className="modal-overlay route-search-payment-overlay" onMouseDown={() => !paymentSaving && setPaymentTarget(null)}>
          <div className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-labelledby="route-payment-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id="route-payment-title">Registrar pago</h2>
                <p>{paymentTarget.unitId} · {paymentTarget.clientName}</p>
              </div>
              <button type="button" className="button ghost small" onClick={() => setPaymentTarget(null)} disabled={paymentSaving}>Cerrar</button>
            </div>
            <div className="route-search-payment-form">
              <label>
                <span>Monto pagado</span>
                <input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} autoFocus />
              </label>
              <label>
                <span>Cómo pagó</span>
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "bank")}>
                  <option value="cash">Efectivo</option>
                  <option value="bank">Banca</option>
                </select>
              </label>
              <label>
                <span>Equipo</span>
                <select value={paymentTeam} onChange={(event) => setPaymentTeam(event.target.value as "" | CollectionTeam)}>
                  <option value="">Seleccionar</option>
                  <option value="PTY">PTY</option>
                  <option value="WC">WC</option>
                </select>
              </label>
              {paymentMethod === "cash" ? (
                <p className="hint">Se generará el recibo y el efectivo quedará pendiente de entrega.</p>
              ) : (
                <p className="hint">Quedará en hold hasta que el banco confirme el movimiento.</p>
              )}
              {paymentError ? <p className="error-text" role="alert">{paymentError}</p> : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setPaymentTarget(null)} disabled={paymentSaving}>Cancelar</button>
              <button type="button" className="button primary" onClick={() => void submitRoutePayment()} disabled={paymentSaving}>
                {paymentSaving ? "Guardando..." : paymentMethod === "cash" ? "Generar recibo" : "Colocar en hold"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                <p>Ruta {group.routeLabel}{group.zoneLabel ? ` · Zona ${group.zoneLabel}` : ""}</p>
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
                const itemManagementTone = managementTone(item.managementType);
                return (
                  <article className={`route-share-card route-share-card--${itemManagementTone} ${item.urgency && item.urgency !== "normal" ? `route-share-card--${item.urgency}` : ""}`} key={item.clientId}>
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
                      <strong>{item.releaseAmount > 0 ? formatCurrency(item.releaseAmount) : "Monto pendiente"}</strong>
                    </div>
                    <div>
                      <small>Vencido</small>
                      <strong>{formatCurrency(item.overdueBalance)}</strong>
                    </div>
                  </div>
                  <div className="route-share-tags">
                    {item.zone ? <span>Zona {item.zone}</span> : <span>Sin zona</span>}
                    <span>{item.daysLate > 0 ? `${item.daysLate} dias de atraso` : "Sin atraso"}</span>
                    <span>{fieldManagementLabel(item.managementType)}</span>
                    {item.urgency && item.urgency !== "normal" ? (
                      <span>{item.urgency === "very_urgent" ? "Muy urgente" : "Urgente"}</span>
                    ) : null}
                  </div>
                  {item.comment ? <p>{item.comment}</p> : null}
                  </article>
                );
              })}
            </div>
            <footer>Ruta {group.routeLabel}{group.zoneLabel ? ` · Zona ${group.zoneLabel}` : ""} · {group.items.length} cliente{group.items.length === 1 ? "" : "s"}</footer>
          </div>
        ))}
      </div>
    </section>
  );
}
