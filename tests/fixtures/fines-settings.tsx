import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import FinesSettingsPanel from "../../src/pages/settings/FinesSettingsPanel";
import { loadClientsFromIndexedDb, saveClients } from "../../src/storage/coreStorage";
import type { Client } from "../../src/types";
import "../../src/styles.css";

const client: Client = {
  id: "fine-client", unitId: "T99", name: "CLIENTE PRUEBA MULTAS", cedula: "8-000-999",
  rentAmount: 25, frequency: "daily", chargeFirstSunday: false, balance: 100, advanceBalance: 0,
  savings: 0, installmentsAgreed: 100, installmentsRemaining: 10, installmentsPaid: 90,
  otherCharges: [], fines: [], createdAt: "2026-08-01T12:00:00Z", lastChargeDate: "2026-09-02", status: "active"
};
const initial = localStorage.getItem("fines-fixture-seeded") ? await loadClientsFromIndexedDb() : [
  client,
  { ...client, id: "other-client", unitId: "T98", fines: [{ id: "existing-fine", type: "NO_ACH_XPRESS" as const, label: "Multa anterior", amount: 1, amountPaid: 1, status: "paid" as const, createdAt: "2026-08-01T12:00:00Z" }] },
  { ...client, id: "archived-client", unitId: "T97", status: "archivado" as const, archivedAt: "2026-08-02T12:00:00Z" }
];
function Harness() {
  const [clients, setClients] = useState<Client[]>(initial);
  return <main style={{ padding: 16, minWidth: 0 }}>
    <FinesSettingsPanel clients={clients} onClientsChange={next => {
      saveClients(next);
      localStorage.setItem("fines-fixture-seeded", "1");
      setClients(next);
    }} />
    <output id="fines-clients" hidden>{JSON.stringify(clients)}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
