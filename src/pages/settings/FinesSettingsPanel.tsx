import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "../../format";
import type { Client, FineType } from "../../types";

const PANAPASS_AMOUNTS = [5, 10, 15, 20, 25, 30] as const;
const FINE_LABELS: Record<FineType, string> = {
  NEGATIVE_PANAPASS_BALANCE: "SALDO NEGATIVO PANAPASS",
  NO_ACH_XPRESS: "MULTA POR NO GENERAR ACH XPRESS",
  MISSING_UNIT_CENTS: "MULTA POR NO COLOCAR LOS CENTAVOS DE SU UNIDAD EN EL PAGO"
};

type Props = {
  clients: Client[];
  onClientsChange: (next: Client[]) => void | Promise<void>;
};

export default function FinesSettingsPanel({ clients, onClientsChange }: Props) {
  const [unitInput, setUnitInput] = useState("");
  const [type, setType] = useState<FineType>("NEGATIVE_PANAPASS_BALANCE");
  const [panapassAmount, setPanapassAmount] = useState<string>("5");
  const [customAmount, setCustomAmount] = useState("");
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

  const fineRows = useMemo(() => {
    return clients
      .flatMap((client) => (client.fines ?? []).map((fine) => ({ client, fine })))
      .sort((a, b) => b.fine.createdAt.localeCompare(a.fine.createdAt));
  }, [clients]);

  function resolveAmount(): number {
    if (type !== "NEGATIVE_PANAPASS_BALANCE") return 1;
    if (panapassAmount !== "custom") return Number(panapassAmount);
    return Number(customAmount);
  }

  async function addFine(): Promise<void> {
    const unit = unitInput.trim().toUpperCase();
    const amount = resolveAmount();
    const nextErrors: string[] = [];
    const client = activeClientsByUnit.get(unit);
    if (!unit) nextErrors.push("Debes indicar una unidad.");
    if (!client) nextErrors.push("No se encontro un cliente activo para esa unidad.");
    if (!Number.isFinite(amount) || amount <= 0) nextErrors.push("El monto de la multa debe ser mayor a 0.");
    if (type === "NEGATIVE_PANAPASS_BALANCE" && panapassAmount === "custom" && amount <= 30) {
      nextErrors.push("Para Panapass mayor, el monto debe ser superior a 30.");
    }
    if (nextErrors.length > 0 || !client) {
      setErrors(nextErrors);
      return;
    }

    const createdAt = new Date().toISOString();
    const nextClients = clients.map((item) => {
      if (item.id !== client.id) return item;
      return {
        ...item,
        fines: [
          ...(item.fines ?? []),
          {
            id: crypto.randomUUID(),
            type,
            label: FINE_LABELS[type],
            amount,
            amountPaid: 0,
            status: "pending" as const,
            createdAt
          }
        ]
      };
    });
    await onClientsChange(nextClients);
    setUnitInput("");
    setCustomAmount("");
    setErrors([]);
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Multas</h2></div>
      <p className="hint" style={{ marginTop: 0 }}>
        Las multas se cobran automaticamente antes de renta, otros cargos, ahorro y adelantos. No se eliminan; cuando se pagan quedan con estado pagado.
      </p>

      <div className="form-grid">
        <label>Numero de unidad
          <input type="text" placeholder="Ej. A02" value={unitInput} onChange={(event) => setUnitInput(event.target.value.trim().toUpperCase())} />
        </label>
        <label>Tipo de multa
          <select value={type} onChange={(event) => setType(event.target.value as FineType)}>
            <option value="NEGATIVE_PANAPASS_BALANCE">Saldo negativo Panapass</option>
            <option value="NO_ACH_XPRESS">No generar ACH Xpress</option>
            <option value="MISSING_UNIT_CENTS">No colocar centavos de unidad</option>
          </select>
        </label>
        {type === "NEGATIVE_PANAPASS_BALANCE" ? (
          <label>Monto Panapass
            <select value={panapassAmount} onChange={(event) => setPanapassAmount(event.target.value)}>
              {PANAPASS_AMOUNTS.map((amount) => <option key={amount} value={String(amount)}>{formatCurrency(amount)}</option>)}
              <option value="custom">Mayor</option>
            </select>
          </label>
        ) : (
          <label>Monto
            <input type="number" value="1" disabled readOnly />
          </label>
        )}
        {type === "NEGATIVE_PANAPASS_BALANCE" && panapassAmount === "custom" && (
          <label>Monto mayor
            <input type="number" min="30.01" step="0.01" placeholder="Ej. 35" value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} />
          </label>
        )}
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="button" className="button primary" onClick={() => void addFine()}>Agregar multa</button>
        </div>
      </div>

      {errors.length > 0 && <ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}

      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr><th>Unidad</th><th>Cliente</th><th>Multa</th><th>Monto</th><th>Pagado</th><th>Pendiente</th><th>Estado</th><th>Fecha</th></tr>
          </thead>
          <tbody>
            {fineRows.length === 0 ? (
              <tr><td colSpan={8} className="empty" style={{ textAlign: "center" }}>No hay multas registradas.</td></tr>
            ) : fineRows.map(({ client, fine }) => {
              const paid = Math.max(0, fine.amountPaid ?? 0);
              const pending = Math.max(0, fine.amount - paid);
              return (
                <tr key={fine.id}>
                  <td><strong>{client.unitId}</strong></td>
                  <td>{client.name}</td>
                  <td>{fine.label}</td>
                  <td>{formatCurrency(fine.amount)}</td>
                  <td>{formatCurrency(paid)}</td>
                  <td>{formatCurrency(pending)}</td>
                  <td>{fine.status === "paid" ? <span className="badge-sim">Pagado</span> : fine.status === "partial" ? <span className="amount-warning">Parcial</span> : <span className="amount-debt">Pendiente</span>}</td>
                  <td>{formatDate(new Date(fine.createdAt))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
