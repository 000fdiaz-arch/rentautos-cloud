import { useMemo, useState } from "react";
import { formatCurrency } from "../../format";
import type { Client } from "../../types";

const PROCESSING_FEE = 10;

type Props = {
  clients: Client[];
  onClientsChange: (next: Client[]) => void | Promise<void>;
};

export default function TicketsSettingsPanel({ clients, onClientsChange }: Props) {
  const [unitInput, setUnitInput] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [ticketAmount, setTicketAmount] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const activeClientsByUnit = useMemo(() => {
    const map = new Map<string, Client>();
    clients
      .filter((client) => !client.archivedAt && client.status !== "archivado")
      .forEach((client) => {
        const unit = client.unitId.trim().toUpperCase();
        if (unit && !map.has(unit)) map.set(unit, client);
      });
    return map;
  }, [clients]);

  const ticketRows = useMemo(() => {
    return clients
      .flatMap((client) => (client.tickets ?? []).map((ticket) => ({ client, ticket })))
      .sort((a, b) => b.ticket.createdAt.localeCompare(a.ticket.createdAt));
  }, [clients]);

  async function addTicket(): Promise<void> {
    const unit = unitInput.trim().toUpperCase();
    const number = ticketNumber.trim().toUpperCase();
    const amount = Number(ticketAmount);
    const nextErrors: string[] = [];
    const client = activeClientsByUnit.get(unit);
    if (!unit) nextErrors.push("Debes indicar una unidad.");
    if (!client) nextErrors.push("No se encontro un cliente activo para esa unidad.");
    if (!number) nextErrors.push("Debes indicar numero o referencia de boleta.");
    if (!Number.isFinite(amount) || amount <= 0) nextErrors.push("El valor de la boleta debe ser mayor a 0.");
    if (nextErrors.length > 0 || !client) {
      setErrors(nextErrors);
      return;
    }

    const normalizedTicketAmount = Math.round((amount + Number.EPSILON) * 100) / 100;
    const totalAmount = Math.round((normalizedTicketAmount + PROCESSING_FEE + Number.EPSILON) * 100) / 100;
    const createdAt = new Date().toISOString();
    const nextClients = clients.map((item) => {
      if (item.id !== client.id) return item;
      return {
        ...item,
        tickets: [
          ...(item.tickets ?? []),
          {
            id: crypto.randomUUID(),
            ticketNumber: number,
            ticketAmount: normalizedTicketAmount,
            processingFee: PROCESSING_FEE,
            amount: totalAmount,
            amountPaid: 0,
            status: "pending" as const,
            comment: comment.trim() || undefined,
            createdAt
          }
        ]
      };
    });
    await onClientsChange(nextClients);
    setUnitInput("");
    setTicketNumber("");
    setTicketAmount("");
    setComment("");
    setErrors([]);
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Boletas</h2></div>
      <p className="hint" style={{ marginTop: 0 }}>
        Cada registro suma {formatCurrency(PROCESSING_FEE)} de tramite al valor total de boleta(s). Si son varias boletas del mismo tramite, coloca sus referencias juntas y el valor total para cobrar un solo tramite.
      </p>

      <div className="form-grid">
        <label>Numero de unidad
          <input type="text" placeholder="Ej. A02" value={unitInput} onChange={(event) => setUnitInput(event.target.value.trim().toUpperCase())} />
        </label>
        <label>Numero(s) o referencia(s)
          <input type="text" placeholder="Ej. 123456 / 123457" value={ticketNumber} onChange={(event) => setTicketNumber(event.target.value)} />
        </label>
        <label>Valor total de boleta(s)
          <input type="number" min="0.01" step="0.01" placeholder="0.00" value={ticketAmount} onChange={(event) => setTicketAmount(event.target.value)} />
        </label>
        <label>Comentario
          <input type="text" placeholder="Opcional" value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="button" className="button primary" onClick={() => void addTicket()}>Agregar boleta</button>
        </div>
      </div>

      {errors.length > 0 && <ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}

      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr><th>Unidad</th><th>Cliente</th><th>Referencia(s)</th><th>Boleta(s)</th><th>Tramite</th><th>Total</th><th>Pagado</th><th>Pendiente</th><th>Estado</th><th>Comentario</th></tr>
          </thead>
          <tbody>
            {ticketRows.length === 0 ? (
              <tr><td colSpan={10} className="empty" style={{ textAlign: "center" }}>No hay boletas registradas.</td></tr>
            ) : ticketRows.map(({ client, ticket }) => {
              const paid = Math.max(0, ticket.amountPaid ?? 0);
              const pending = Math.max(0, ticket.amount - paid);
              return (
                <tr key={ticket.id}>
                  <td><strong>{client.unitId}</strong></td>
                  <td>{client.name}</td>
                  <td>{ticket.ticketNumber}</td>
                  <td>{formatCurrency(ticket.ticketAmount)}</td>
                  <td>{formatCurrency(ticket.processingFee)}</td>
                  <td>{formatCurrency(ticket.amount)}</td>
                  <td>{formatCurrency(paid)}</td>
                  <td>{formatCurrency(pending)}</td>
                  <td>{ticket.status === "paid" ? <span className="badge-sim">Pagado</span> : ticket.status === "partial" ? <span className="amount-warning">Parcial</span> : <span className="amount-debt">Pendiente</span>}</td>
                  <td>{ticket.comment ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
