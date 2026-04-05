import { useDeferredValue, useState, type FormEvent } from "react";
import ClientRow from "../components/ClientRow";
import EmptyBlock from "../components/EmptyBlock";
import type { Client, NewClientInput } from "../types";
import type { ClientMetricsById } from "../utils/ledger";
import { filterAndSortClients } from "../utils/ledger";

interface ClientsPanelProps {
  clients: Client[];
  metricsById: ClientMetricsById;
  activeClientId: string;
  onSelectClient: (clientId: string) => void;
  onCreateClient: (input: NewClientInput) => void;
}

function ClientsPanel({
  clients,
  metricsById,
  activeClientId,
  onSelectClient,
  onCreateClient,
}: ClientsPanelProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [form, setForm] = useState<NewClientInput>({
    name: "",
    alias: "",
    phone: "",
    notes: "",
  });

  const visibleClients = filterAndSortClients(clients, deferredSearch, metricsById);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      return;
    }

    onCreateClient(form);
    setForm({
      name: "",
      alias: "",
      phone: "",
      notes: "",
    });
  }

  return (
    <section className="panel" id="clientes">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Clientes</p>
          <h2>Cuentas activas</h2>
        </div>
        <span>{visibleClients.length} visibles</span>
      </div>

      <label className="input-block">
        Buscar
        <input
          placeholder="Nombre, alias o codigo"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      <form className="stacked-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <label className="input-block">
            Nombre
            <input
              placeholder="Ej. Jose Lopez"
              value={form.name}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label className="input-block">
            Alias
            <input
              placeholder="Como lo reconoce el banco"
              value={form.alias}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  alias: event.target.value,
                }))
              }
            />
          </label>
        </div>

        <div className="form-row">
          <label className="input-block">
            Telefono
            <input
              placeholder="Numero de contacto"
              value={form.phone}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  phone: event.target.value,
                }))
              }
            />
          </label>
          <label className="input-block">
            Nota
            <input
              placeholder="Dato util"
              value={form.notes}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  notes: event.target.value,
                }))
              }
            />
          </label>
        </div>

        <button type="submit">Agregar cliente</button>
      </form>

      <div className="client-list">
        {visibleClients.length > 0 ? (
          visibleClients.map((client) => {
            const metrics = metricsById[client.id];

            return (
              <ClientRow
                key={client.id}
                balance={metrics?.balance ?? 0}
                client={client}
                isActive={client.id === activeClientId}
                onClick={() => onSelectClient(client.id)}
                state={metrics?.state ?? "al-dia"}
              />
            );
          })
        ) : (
          <EmptyBlock title="Sin resultados" body="No encontre clientes con ese filtro." />
        )}
      </div>
    </section>
  );
}

export default ClientsPanel;
