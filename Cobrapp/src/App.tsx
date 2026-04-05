import { useEffect, useState } from "react";
import "./styles.css";
import { createFallbackState, loadStoredState, saveStoredState } from "./app/storage";
import { demoClients, demoMovements } from "./data";
import Sidebar from "./components/Sidebar";
import SummarySection from "./sections/SummarySection";
import ClientsPanel from "./sections/ClientsPanel";
import MovementPanel from "./sections/MovementPanel";
import BankPanel from "./sections/BankPanel";
import type { BankRow, Client, Movement, NewClientInput, NewMovementInput } from "./types";
import { createId } from "./utils/ids";
import {
  buildClientMetrics,
  buildOverview,
  getClientMovements,
} from "./utils/ledger";
import {
  applyBankRowToMovements,
  assignBankRowClient,
  buildBankRows,
  markBankRowProcessed,
} from "./utils/bank";
import { getTodayIsoDate } from "./app/constants";

const initialState = loadStoredState() ?? createFallbackState();

function App() {
  const [clients, setClients] = useState<Client[]>(initialState.clients);
  const [movements, setMovements] = useState<Movement[]>(initialState.movements);
  const [bankRows, setBankRows] = useState<BankRow[]>(initialState.bankRows);
  const [selectedClientId, setSelectedClientId] = useState(initialState.clients[0]?.id ?? "");

  useEffect(() => {
    saveStoredState({
      version: 1,
      clients,
      movements,
      bankRows,
    });
  }, [bankRows, clients, movements]);

  useEffect(() => {
    if (clients.length === 0) {
      if (selectedClientId) {
        setSelectedClientId("");
      }
      return;
    }

    const stillExists = clients.some((client) => client.id === selectedClientId);

    if (!stillExists) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  const metricsById = buildClientMetrics(clients, movements);
  const overview = buildOverview(metricsById, movements, bankRows);
  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
  const selectedClientMetrics = selectedClient ? metricsById[selectedClient.id] ?? null : null;
  const selectedClientMovements = selectedClient
    ? getClientMovements(selectedClient.id, movements)
    : [];

  function handleCreateClient(input: NewClientInput) {
    const today = getTodayIsoDate();
    const nextCodeNumber = clients.length + 1;
    const trimmedName = input.name.trim();

    if (!trimmedName) {
      return;
    }

    const client: Client = {
      id: createId("client"),
      code: `C${String(nextCodeNumber).padStart(3, "0")}`,
      name: trimmedName,
      alias: input.alias.trim() || trimmedName,
      phone: input.phone.trim() || "Sin telefono",
      notes: input.notes.trim() || "Sin notas",
      bankTags: [trimmedName, input.alias.trim()].filter(Boolean),
      createdAt: today,
    };

    setClients((currentClients) => [client, ...currentClients]);
    setSelectedClientId(client.id);
  }

  function handleCreateMovement(input: NewMovementInput) {
    if (!selectedClient) {
      return;
    }

    const nextMovement: Movement = {
      id: createId("mov"),
      clientId: selectedClient.id,
      date: input.date,
      type: input.type,
      amount: input.type === "ajuste" ? input.amount : Math.abs(input.amount),
      description: input.description.trim() || "Movimiento manual",
      source: "manual",
    };

    setMovements((currentMovements) => [nextMovement, ...currentMovements]);
  }

  function handleImportCsvText(text: string) {
    const nextRows = buildBankRows(text, clients, movements);
    setBankRows(nextRows);
    return nextRows.length;
  }

  function handleAssignBankClient(rowId: string, clientId: string) {
    setBankRows((currentRows) => assignBankRowClient(currentRows, rowId, clientId));
  }

  function handleApplyBankRow(rowId: string) {
    const row = bankRows.find((currentRow) => currentRow.id === rowId);

    if (!row || !row.matchedClientId) {
      return;
    }

    setMovements((currentMovements) => applyBankRowToMovements(row, currentMovements));
    setBankRows((currentRows) => markBankRowProcessed(currentRows, rowId));
  }

  function handleResetDemo() {
    setClients(demoClients);
    setMovements(demoMovements);
    setBankRows([]);
    setSelectedClientId(demoClients[0]?.id ?? "");
  }

  return (
    <div className="app-shell">
      <Sidebar onResetDemo={handleResetDemo} />

      <main className="workspace">
        <SummarySection {...overview} />

        <section className="work-grid">
          <ClientsPanel
            activeClientId={selectedClient?.id ?? ""}
            clients={clients}
            metricsById={metricsById}
            onCreateClient={handleCreateClient}
            onSelectClient={setSelectedClientId}
          />

          <MovementPanel
            client={selectedClient}
            clientMetrics={selectedClientMetrics}
            movements={selectedClientMovements}
            onCreateMovement={handleCreateMovement}
          />

          <BankPanel
            bankRows={bankRows}
            clients={clients}
            onApply={handleApplyBankRow}
            onAssignClient={handleAssignBankClient}
            onImportCsvText={handleImportCsvText}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
