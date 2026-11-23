import { useMemo, useRef, useState } from "react";
import type { Client, CollectionDelta, CollectionTeam, Payment } from "../types";
import type { ActiveRouteItem } from "../cloudData";
import { collectionTeamForDelta } from "../cashTeamRules";
import { ROUTE_DELTAS } from "../routeDeltaTracking";
import { formatCurrency } from "../format";

export type RoutePaymentInput = {
  clientId: string;
  amount: number;
  method: "cash" | "bank";
  team: CollectionTeam;
  delta?: CollectionDelta;
  reportId?: string;
  fundsReceivedDate?: string;
  outsideRoute?: boolean;
};
export type RoutePaymentResult = { kind: "cash" | "bank"; receiptNumber?: string; payment?: Payment };
export type RouteDeclarationMethod = "cash" | "bank" | "mixed";
export const ROUTE_PAYMENT_DECLARATIONS = {
  cash: { title: "Declarar efectivo", badge: "EN RUTA Y FUERA DE RUTA" },
  bank: { title: "Declarar transferencia", badge: "SOLO UNIDADES EN RUTA" },
  mixed: { title: "Declarar pago mixto", badge: "SOLO UNIDADES EN RUTA" }
} as const;

type Props = {
  clients: Client[];
  delta: CollectionDelta | null;
  method: RouteDeclarationMethod;
  routeClientIds: Set<string>;
  checkRoute: (clientId: string) => Promise<ActiveRouteItem | null>;
  onExistingRoute: (item: ActiveRouteItem) => Promise<void>;
  onRegister?: (input: RoutePaymentInput) => Promise<RoutePaymentResult>;
  onSuccess: (client: Client, result: RoutePaymentResult) => void;
  onClose: () => void;
};

export default function RoutePaymentDeclarationDialog(props: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);
  const [amount, setAmount] = useState("");
  const [selectedDelta, setDelta] = useState<CollectionDelta | "">("");
  const delta = props.delta ?? selectedDelta;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const routeOnly = props.method !== "cash" || !props.onRegister;
  const declaration = ROUTE_PAYMENT_DECLARATIONS[props.method];
  const candidates = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    if (!term) return [];
    return props.clients.filter(client => client.status === "activo" && !client.archivedAt
      && (!routeOnly || props.routeClientIds.has(client.id))
      && [client.unitId, client.name, client.cedula ?? ""].some(value => value.toLocaleLowerCase("es").includes(term)))
      .sort((a, b) => a.unitId.localeCompare(b.unitId, "es", { numeric: true }));
  }, [props.clients, props.routeClientIds, query, routeOnly]);

  async function selectClient(client: Client) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const item = await props.checkRoute(client.id);
      if (item && !item.removedAt) {
        await props.onExistingRoute(item);
        props.onClose();
      } else {
        if (routeOnly) throw new Error("SOLO UNIDADES EN RUTA. Esta unidad ya no está en ruta. Actualiza la lista.");
        setSelected(client);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo comprobar la ruta. Intenta nuevamente.");
    } finally { lock.current = false; setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !selected || !delta || !props.onRegister || props.method !== "cash") return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 9999999999.99
      || Math.abs(value * 100 - Math.round(value * 100)) >= 0.00001) {
      setError("Indica un monto mayor a cero, con hasta dos decimales."); return;
    }
    lock.current = true; setBusy(true); setError("");
    try {
      const item = await props.checkRoute(selected.id);
      if (item && !item.removedAt) {
        await props.onExistingRoute(item);
        props.onClose(); return;
      }
      const result = await props.onRegister({ clientId: selected.id, amount: value, method: "cash",
        team: collectionTeamForDelta(delta), delta, outsideRoute: true });
      if (result.kind !== "cash" || !result.receiptNumber) throw new Error("No se recibió el número de recibo. Actualiza antes de volver a cobrar.");
      props.onSuccess(selected, result);
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el efectivo. Intenta nuevamente.");
    } finally { lock.current = false; setBusy(false); }
  }

  return <div className="modal-overlay route-search-payment-overlay">
    <form className="modal outside-route-cash-modal" role="dialog" aria-modal="true" aria-labelledby="outside-route-title" onSubmit={submit}>
      <div className="modal-header"><div><h2 id="outside-route-title">{declaration.title}{props.method === "mixed" ? " (Efectivo+transferencia)" : ""}</h2><p><span className="outside-route-cash-only-label">{declaration.badge}</span>{selected ? " · Fuera de ruta" : ""}</p></div>
        <button type="button" className="button ghost small" disabled={busy} onClick={props.onClose}>Cerrar</button></div>
      <div className="outside-route-cash-body">
        {!selected ? <>
          <label><span>Buscar unidad o cliente</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Unidad, nombre o cédula" disabled={busy} /></label>
          <p className="hint">{routeOnly ? "Busca una de tus unidades en ruta para declarar el pago." : "Busca la unidad para declarar el efectivo, esté en ruta o fuera de ruta."}</p>
          <div className="outside-route-client-results" aria-label="Clientes encontrados" aria-busy={busy}>
            {candidates.map(client => <button type="button" key={client.id} disabled={busy} onClick={() => void selectClient(client)}>
              <strong>{client.unitId}</strong><span>{client.name}</span><small>{client.cedula}</small></button>)}
            {query.trim() && candidates.length === 0 ? <p>{routeOnly ? "No hay unidades en ruta con esa búsqueda." : "No hay clientes activos con esa búsqueda."}</p> : null}
          </div>
        </> : <>
          <div className="outside-route-selected"><div><strong>{selected.unitId} · {selected.name}</strong><span>Saldo actual: {formatCurrency(selected.balance)}</span></div>
            <button type="button" className="button ghost small" disabled={busy} onClick={() => { setSelected(null); setAmount(""); setError(""); }}>Cambiar unidad</button></div>
          <label><span>Efectivo recibido ($)</span><input autoFocus type="number" min="0.01" max="9999999999.99" step="0.01" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /></label>
          {!props.delta ? <label><span>Delta que recibió el efectivo</span><select required value={delta} disabled={busy} onChange={event => setDelta(event.target.value as CollectionDelta | "")}>
            <option value="">Seleccionar</option>{ROUTE_DELTAS.map(row => <option key={row.key} value={row.key}>{row.label} · {row.route}</option>)}
          </select></label> : null}
          <p className="hint">Se aplicará el pago y se generará el recibo. El efectivo quedará pendiente de entrega del equipo {delta ? collectionTeamForDelta(delta) : "seleccionado"}.</p>
          <p className="hint">La unidad conservará su gestión y no se agregará a la ruta.</p>
        </>}
        {busy ? <p role="status">{selected ? "Registrando cobro…" : "Comprobando unidad…"}</p> : null}
        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </div>
      <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={props.onClose}>Cancelar</button>
        {selected ? <button type="submit" className="button primary" disabled={busy || !delta || !amount}>{busy ? "Guardando…" : "Confirmar y generar recibo"}</button> : null}</div>
    </form>
  </div>;
}
