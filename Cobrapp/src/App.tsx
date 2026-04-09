import { useMemo, useState } from "react";
import { loadClients, saveClients } from "./storage";
import type { BillingFrequency, Client, WeeklyChargeDay } from "./types";

const FREQUENCY_LABEL: Record<BillingFrequency, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual"
};

const WEEKLY_DAY_LABEL: Record<WeeklyChargeDay, string> = {
  monday: "lunes",
  tuesday: "martes",
  wednesday: "miercoles",
  thursday: "jueves",
  friday: "viernes",
  saturday: "sabado"
};

type ClientForm = {
  unitId: string;
  name: string;
  rentAmount: string;
  frequency: BillingFrequency;
  initialBalance: string;
  weeklyChargeDay: WeeklyChargeDay;
  monthlyChargeDay: string;
  installmentsAgreed: string;
  installmentsRemaining: string;
  installmentsPaid: string;
  otherChargeLabel: string;
  otherChargeAmount: string;
};

const initialForm: ClientForm = {
  unitId: "",
  name: "",
  rentAmount: "",
  frequency: "monthly",
  initialBalance: "",
  weeklyChargeDay: "monday",
  monthlyChargeDay: "1",
  installmentsAgreed: "",
  installmentsRemaining: "",
  installmentsPaid: "",
  otherChargeLabel: "",
  otherChargeAmount: ""
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function parseNumberOrNull(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAdjustedMonthlyChargeDate(
  year: number,
  monthIndex: number,
  monthlyChargeDay: number
): Date {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  const plannedDay = Math.min(monthlyChargeDay, lastDayOfMonth);
  const adjusted = new Date(year, monthIndex, plannedDay);
  if (adjusted.getDay() === 0) {
    adjusted.setDate(adjusted.getDate() - 1);
  }
  return adjusted;
}

function getNextMonthlyChargeDate(monthlyChargeDay: number): Date {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const currentMonthCandidate = getAdjustedMonthlyChargeDate(
    today.getFullYear(),
    today.getMonth(),
    monthlyChargeDay
  );

  if (currentMonthCandidate >= startOfToday) {
    return currentMonthCandidate;
  }

  const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return getAdjustedMonthlyChargeDate(
    nextMonthDate.getFullYear(),
    nextMonthDate.getMonth(),
    monthlyChargeDay
  );
}

function getChargeRuleText(client: Client): string {
  if (client.frequency === "daily") {
    return "Cobro de lunes a sabado";
  }
  if (client.frequency === "weekly") {
    return `Cobro todos los ${WEEKLY_DAY_LABEL[client.weeklyChargeDay ?? "monday"]}`;
  }
  if (client.frequency === "biweekly") {
    return "Cobros fijos: dia 15 y fin de mes";
  }

  const monthlyChargeDay = client.monthlyChargeDay ?? 1;
  const nextChargeDate = getNextMonthlyChargeDate(monthlyChargeDay);
  return `Dia ${monthlyChargeDay} de cada mes (si cae domingo, pasa a sabado). Proximo: ${nextChargeDate.toLocaleDateString(
    "es-PA"
  )}`;
}

function buildClient(form: ClientForm): Client {
  const client: Client = {
    id: crypto.randomUUID(),
    unitId: form.unitId.trim(),
    name: form.name.trim(),
    rentAmount: Number(form.rentAmount),
    frequency: form.frequency,
    balance: Number(form.initialBalance),
    installmentsAgreed: Number(form.installmentsAgreed),
    installmentsRemaining: Number(form.installmentsRemaining),
    installmentsPaid: Number(form.installmentsPaid),
    otherChargeLabel: form.otherChargeLabel.trim() || undefined,
    otherChargeAmount: parseNumberOrNull(form.otherChargeAmount) ?? undefined,
    createdAt: new Date().toISOString()
  };

  if (form.frequency === "weekly") {
    client.weeklyChargeDay = form.weeklyChargeDay;
  }
  if (form.frequency === "monthly") {
    client.monthlyChargeDay = Number(form.monthlyChargeDay);
  }
  return client;
}

export default function App() {
  const [clients, setClients] = useState<Client[]>(() => loadClients());
  const [form, setForm] = useState<ClientForm>(initialForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [draftBalances, setDraftBalances] = useState<Record<string, string>>({});

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.unitId.localeCompare(b.unitId)),
    [clients]
  );
  const totalBalance = useMemo(
    () => clients.reduce((acc, client) => acc + client.balance, 0),
    [clients]
  );

  function persist(next: Client[]): void {
    setClients(next);
    saveClients(next);
  }

  function recalculateInstallments(nextForm: ClientForm): ClientForm {
    const agreed = parseNumberOrNull(nextForm.installmentsAgreed);
    const remaining = parseNumberOrNull(nextForm.installmentsRemaining);
    const paid = parseNumberOrNull(nextForm.installmentsPaid);

    const available = [
      agreed !== null ? "agreed" : null,
      remaining !== null ? "remaining" : null,
      paid !== null ? "paid" : null
    ].filter(Boolean).length;

    if (available < 2) {
      return nextForm;
    }

    if (agreed === null && remaining !== null && paid !== null) {
      return { ...nextForm, installmentsAgreed: String(remaining + paid) };
    }
    if (remaining === null && agreed !== null && paid !== null) {
      return { ...nextForm, installmentsRemaining: String(agreed - paid) };
    }
    if (paid === null && agreed !== null && remaining !== null) {
      return { ...nextForm, installmentsPaid: String(agreed - remaining) };
    }

    return nextForm;
  }

  function validate(input: ClientForm): string[] {
    const nextErrors: string[] = [];
    if (!input.unitId.trim()) {
      nextErrors.push("UNIDAD/ID es obligatorio.");
    }

    const normalizedUnit = input.unitId.trim().toLowerCase();
    const unitDuplicated = clients.some(
      (client) => client.unitId.trim().toLowerCase() === normalizedUnit
    );
    if (unitDuplicated) {
      nextErrors.push("UNIDAD/ID ya existe. No se permiten duplicados.");
    }

    if (!input.name.trim()) {
      nextErrors.push("El nombre del cliente es obligatorio.");
    }

    const rentAmount = Number(input.rentAmount);
    if (!Number.isFinite(rentAmount) || rentAmount < 0) {
      nextErrors.push("La renta debe ser un numero mayor o igual a 0.");
    }

    const initialBalance = Number(input.initialBalance);
    if (!Number.isFinite(initialBalance)) {
      nextErrors.push("El saldo inicial (atrasado) debe ser un numero valido.");
    }

    const agreed = Number(input.installmentsAgreed);
    const remaining = Number(input.installmentsRemaining);
    const paid = Number(input.installmentsPaid);
    if (
      !Number.isFinite(agreed) ||
      !Number.isFinite(remaining) ||
      !Number.isFinite(paid) ||
      agreed < 0 ||
      remaining < 0 ||
      paid < 0
    ) {
      nextErrors.push("Las cuotas deben ser numeros validos mayores o iguales a 0.");
    } else if (agreed !== remaining + paid) {
      nextErrors.push("Las cuotas no cuadran. Pactadas debe ser igual a Restantes + Pagadas.");
    }

    if (input.frequency === "monthly") {
      const monthlyChargeDay = Number(input.monthlyChargeDay);
      if (
        !Number.isInteger(monthlyChargeDay) ||
        monthlyChargeDay < 1 ||
        monthlyChargeDay > 31
      ) {
        nextErrors.push("Para mensual, el dia de cobro debe estar entre 1 y 31.");
      }
    }

    const otherAmount = parseNumberOrNull(input.otherChargeAmount);
    if (input.otherChargeLabel.trim() && otherAmount === null) {
      nextErrors.push("Si defines otro cargo, debes colocar el monto.");
    }
    if (!input.otherChargeLabel.trim() && otherAmount !== null) {
      nextErrors.push("Si defines monto de otro cargo, debes colocar el concepto.");
    }

    return nextErrors;
  }

  function handleInstallmentChange(
    field: "installmentsAgreed" | "installmentsRemaining" | "installmentsPaid",
    value: string
  ): void {
    setForm((current) => recalculateInstallments({ ...current, [field]: value }));
  }

  function handleCreateClient(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (nextErrors.length > 0) {
      return;
    }

    persist([...clients, buildClient(form)]);
    setForm(initialForm);
    setErrors([]);
  }

  function handleDeleteClient(id: string): void {
    persist(clients.filter((client) => client.id !== id));
  }

  function handleSaveBalance(clientId: string): void {
    const inputValue = draftBalances[clientId];
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed)) {
      return;
    }
    persist(
      clients.map((client) => (client.id === clientId ? { ...client, balance: parsed } : client))
    );
    setDraftBalances((current) => {
      const copy = { ...current };
      delete copy[clientId];
      return copy;
    });
  }

  return (
    <main className="page">
      <header className="hero">
        <h1>Cobrapp - Modulo 1</h1>
        <p>Clientes y reglas automaticas de cobro en USD.</p>
      </header>

      <section className="summary-grid">
        <article className="summary-card">
          <span>Clientes activos</span>
          <strong>{clients.length}</strong>
        </article>
        <article className="summary-card">
          <span>Saldo total por cobrar</span>
          <strong>{formatCurrency(totalBalance)}</strong>
        </article>
      </section>

      <section className="panel">
        <h2>Nuevo cliente</h2>
        <form className="form-grid" onSubmit={handleCreateClient}>
          <label>
            UNIDAD/ID
            <input
              type="text"
              value={form.unitId}
              onChange={(event) =>
                setForm((current) => ({ ...current, unitId: event.target.value }))
              }
              placeholder="Ej. APT-101"
              required
            />
          </label>

          <label>
            Nombre
            <input
              type="text"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Ej. Richard Alexander"
              required
            />
          </label>

          <label>
            Renta (USD)
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.rentAmount}
              onChange={(event) =>
                setForm((current) => ({ ...current, rentAmount: event.target.value }))
              }
              placeholder="0.00"
              required
            />
          </label>

          <label>
            Frecuencia
            <select
              value={form.frequency}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  frequency: event.target.value as BillingFrequency
                }))
              }
            >
              <option value="daily">Diaria</option>
              <option value="weekly">Semanal</option>
              <option value="biweekly">Quincenal</option>
              <option value="monthly">Mensual</option>
            </select>
          </label>

          <label>
            Cuotas pactadas
            <input
              type="number"
              step="1"
              min="0"
              value={form.installmentsAgreed}
              onChange={(event) => handleInstallmentChange("installmentsAgreed", event.target.value)}
              required
            />
          </label>

          <label>
            Cuotas restantes
            <input
              type="number"
              step="1"
              min="0"
              value={form.installmentsRemaining}
              onChange={(event) =>
                handleInstallmentChange("installmentsRemaining", event.target.value)
              }
              required
            />
          </label>

          <label>
            Cuotas pagadas
            <input
              type="number"
              step="1"
              min="0"
              value={form.installmentsPaid}
              onChange={(event) => handleInstallmentChange("installmentsPaid", event.target.value)}
              required
            />
          </label>

          <label>
            Saldo inicial (atrasado) USD
            <input
              type="number"
              step="0.01"
              value={form.initialBalance}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  initialBalance: event.target.value
                }))
              }
              placeholder="0.00"
              required
            />
          </label>

          <label>
            Otro cargo (concepto)
            <input
              type="text"
              value={form.otherChargeLabel}
              onChange={(event) =>
                setForm((current) => ({ ...current, otherChargeLabel: event.target.value }))
              }
              placeholder="Ej. Mantenimiento"
            />
          </label>

          <label>
            Otro cargo (monto USD)
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.otherChargeAmount}
              onChange={(event) =>
                setForm((current) => ({ ...current, otherChargeAmount: event.target.value }))
              }
              placeholder="0.00"
            />
          </label>

          {form.frequency === "weekly" && (
            <label>
              Dia de cobro semanal
              <select
                value={form.weeklyChargeDay}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    weeklyChargeDay: event.target.value as WeeklyChargeDay
                  }))
                }
              >
                <option value="monday">Lunes</option>
                <option value="tuesday">Martes</option>
                <option value="wednesday">Miercoles</option>
                <option value="thursday">Jueves</option>
                <option value="friday">Viernes</option>
                <option value="saturday">Sabado</option>
              </select>
            </label>
          )}

          {form.frequency === "monthly" && (
            <label>
              Dia del mes para cobrar
              <input
                type="number"
                min="1"
                max="31"
                step="1"
                value={form.monthlyChargeDay}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    monthlyChargeDay: event.target.value
                  }))
                }
                required
              />
            </label>
          )}

          <button type="submit" className="button primary">
            Guardar cliente
          </button>
        </form>

        {form.frequency === "daily" && (
          <p className="hint">Regla diaria: cobro automatico de lunes a sabado.</p>
        )}
        {form.frequency === "biweekly" && (
          <p className="hint">Regla quincenal: cobros fijos dia 15 y fin de mes.</p>
        )}
        {form.frequency === "monthly" && (
          <p className="hint">
            Regla mensual: si el dia configurado cae domingo, el cobro se mueve al sabado.
          </p>
        )}

        {errors.length > 0 && (
          <ul className="error-list">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Clientes</h2>
        {sortedClients.length === 0 ? (
          <p className="empty">Aun no hay clientes. Agrega el primero en el formulario.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>UNIDAD/ID</th>
                  <th>Cliente</th>
                  <th>Renta</th>
                  <th>Frecuencia</th>
                  <th>Regla de cobro</th>
                  <th>Cuotas pactadas</th>
                  <th>Cuotas restantes</th>
                  <th>Cuotas pagadas</th>
                  <th>Otros cargos</th>
                  <th>Saldo actual</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sortedClients.map((client) => {
                  const draftValue =
                    draftBalances[client.id] === undefined
                      ? client.balance.toString()
                      : draftBalances[client.id];
                  const otherChargeText =
                    client.otherChargeLabel && client.otherChargeAmount !== undefined
                      ? `${client.otherChargeLabel}: ${formatCurrency(client.otherChargeAmount)}`
                      : "-";

                  return (
                    <tr key={client.id}>
                      <td>{client.unitId}</td>
                      <td>{client.name}</td>
                      <td>{formatCurrency(client.rentAmount)}</td>
                      <td>{FREQUENCY_LABEL[client.frequency]}</td>
                      <td>{getChargeRuleText(client)}</td>
                      <td>{client.installmentsAgreed}</td>
                      <td>{client.installmentsRemaining}</td>
                      <td>{client.installmentsPaid}</td>
                      <td>{otherChargeText}</td>
                      <td>
                        <div className="balance-editor">
                          <input
                            type="number"
                            step="0.01"
                            value={draftValue}
                            onChange={(event) =>
                              setDraftBalances((current) => ({
                                ...current,
                                [client.id]: event.target.value
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="button ghost"
                            onClick={() => handleSaveBalance(client.id)}
                          >
                            Actualizar
                          </button>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button danger"
                          onClick={() => handleDeleteClient(client.id)}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
