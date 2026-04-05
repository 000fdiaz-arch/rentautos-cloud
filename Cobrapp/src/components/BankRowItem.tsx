import { bankStateLabels, getTodayIsoDate } from "../app/constants";
import type { BankRow, Client } from "../types";
import { formatDate, formatMoney } from "../utils/format";

interface BankRowItemProps {
  row: BankRow;
  clients: Client[];
  onAssignClient: (rowId: string, clientId: string) => void;
  onApply: (rowId: string) => void;
}

function BankRowItem({ row, clients, onAssignClient, onApply }: BankRowItemProps) {
  const actionLabel =
    row.status === "procesado"
      ? "Aplicado"
      : row.suggestedMovementId
        ? "Conciliar"
        : row.matchedClientId
          ? "Registrar abono"
          : "Elegir cliente";

  const disabled = row.status === "procesado" || !row.matchedClientId;

  return (
    <article className={`bank-row bank-row--${row.status}`}>
      <div className="bank-row__top">
        <div>
          <strong>{row.reference || "Sin referencia"}</strong>
          <span>
            {formatDate(row.date || getTodayIsoDate())} | {row.clientLabel || "Sin nombre"}
          </span>
        </div>
        <strong className="bank-row__amount">{formatMoney(row.amount)}</strong>
      </div>

      <div className="bank-row__controls">
        <label className="input-block">
          Cliente
          <select
            value={row.matchedClientId ?? ""}
            onChange={(event) => onAssignClient(row.id, event.target.value)}
          >
            <option value="">Elegir</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} - {client.name}
              </option>
            ))}
          </select>
        </label>

        <button disabled={disabled} onClick={() => onApply(row.id)} type="button">
          {actionLabel}
        </button>
      </div>

      <div className="bank-row__footer">
        <span className={`state-pill state-pill--${row.status}`}>
          {bankStateLabels[row.status]}
        </span>
        <p>{row.notes}</p>
      </div>
    </article>
  );
}

export default BankRowItem;
