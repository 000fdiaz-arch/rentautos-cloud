import { clientStateLabels, getTodayIsoDate } from "../app/constants";
import EmptyBlock from "../components/EmptyBlock";
import MovementRow from "../components/MovementRow";
import { useState, type FormEvent } from "react";
import type { Client, Movement, NewMovementInput, MovementType } from "../types";
import type { ClientMetrics } from "../utils/ledger";
import { formatMoney } from "../utils/format";

interface MovementPanelProps {
  client: Client | null;
  clientMetrics: ClientMetrics | null;
  movements: Movement[];
  onCreateMovement: (input: NewMovementInput) => void;
}

function MovementPanel({
  client,
  clientMetrics,
  movements,
  onCreateMovement,
}: MovementPanelProps) {
  const [form, setForm] = useState({
    date: getTodayIsoDate(),
    type: "cargo" as MovementType,
    amount: "",
    description: "",
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!client) {
      return;
    }

    const amount = Number.parseFloat(form.amount);

    if (!Number.isFinite(amount) || amount === 0) {
      return;
    }

    onCreateMovement({
      date: form.date,
      type: form.type,
      amount,
      description: form.description,
    });

    setForm((currentForm) => ({
      ...currentForm,
      date: getTodayIsoDate(),
      amount: "",
      description: "",
    }));
  }

  if (!client || !clientMetrics) {
    return (
      <section className="panel panel--wide" id="movimientos">
        <EmptyBlock
          title="Primero elige un cliente"
          body="Luego podras ver el saldo y registrar movimientos."
        />
      </section>
    );
  }

  return (
    <section className="panel panel--wide" id="movimientos">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Cuenta del cliente</p>
          <h2>{client.name}</h2>
          <span>
            {client.code} | {client.alias} | {client.phone}
          </span>
        </div>

        <div className="ledger-balance">
          <span>Saldo actual</span>
          <strong>{formatMoney(clientMetrics.balance)}</strong>
          <span className={`state-pill state-pill--${clientMetrics.state}`}>
            {clientStateLabels[clientMetrics.state]}
          </span>
        </div>
      </div>

      <div className="client-note">
        <strong>Nota rapida</strong>
        <p>{client.notes}</p>
      </div>

      <form className="stacked-form stacked-form--highlight" onSubmit={handleSubmit}>
        <div className="panel-head panel-head--tight">
          <div>
            <p className="eyebrow">Nuevo movimiento</p>
            <h3>Actualizar cuenta</h3>
          </div>
          <span>Usa ajuste con valor positivo o negativo segun cambie el saldo.</span>
        </div>

        <div className="form-row">
          <label className="input-block">
            Fecha
            <input
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  date: event.target.value,
                }))
              }
            />
          </label>

          <label className="input-block">
            Tipo
            <select
              value={form.type}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  type: event.target.value as MovementType,
                }))
              }
            >
              <option value="cargo">Cargo</option>
              <option value="abono">Abono</option>
              <option value="ajuste">Ajuste</option>
            </select>
          </label>
        </div>

        <div className="form-row">
          <label className="input-block">
            Monto
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={form.amount}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  amount: event.target.value,
                }))
              }
            />
          </label>

          <label className="input-block">
            Descripcion
            <input
              placeholder="Ej. Pago parcial o correccion"
              value={form.description}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  description: event.target.value,
                }))
              }
            />
          </label>
        </div>

        <button type="submit">Guardar movimiento</button>
      </form>

      <div className="movement-list">
        {movements.length > 0 ? (
          movements.map((movement) => <MovementRow key={movement.id} movement={movement} />)
        ) : (
          <EmptyBlock title="Sin movimientos" body="Este cliente aun no tiene historial." />
        )}
      </div>
    </section>
  );
}

export default MovementPanel;
