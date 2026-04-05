import { clientStateLabels } from "../app/constants";
import type { Client, ClientState } from "../types";
import { formatMoney } from "../utils/format";

interface ClientRowProps {
  client: Client;
  balance: number;
  state: ClientState;
  isActive: boolean;
  onClick: () => void;
}

function ClientRow({ client, balance, state, isActive, onClick }: ClientRowProps) {
  return (
    <button
      className={`client-row ${isActive ? "client-row--active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <div>
        <strong>{client.name}</strong>
        <span>
          {client.code} | {client.phone}
        </span>
      </div>
      <div className="client-row__meta">
        <span className={`state-pill state-pill--${state}`}>{clientStateLabels[state]}</span>
        <strong>{formatMoney(balance)}</strong>
      </div>
    </button>
  );
}

export default ClientRow;
