import { useState, useTransition, type ChangeEvent } from "react";
import { demoBankCsv } from "../data";
import BankRowItem from "../components/BankRowItem";
import EmptyBlock from "../components/EmptyBlock";
import type { BankRow, Client } from "../types";

interface BankPanelProps {
  clients: Client[];
  bankRows: BankRow[];
  onImportCsvText: (text: string) => number;
  onAssignClient: (rowId: string, clientId: string) => void;
  onApply: (rowId: string) => void;
}

function BankPanel({
  clients,
  bankRows,
  onImportCsvText,
  onAssignClient,
  onApply,
}: BankPanelProps) {
  const [csvMessage, setCsvMessage] = useState(
    "Sube un CSV del banco o usa el ejemplo para revisar coincidencias.",
  );
  const [isImporting, startImportTransition] = useTransition();

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const text = await file.text();

    startImportTransition(() => {
      const count = onImportCsvText(text);
      setCsvMessage(
        count > 0 ? `${count} movimientos del banco cargados.` : "No encontre filas utiles en ese archivo.",
      );
    });
  }

  function handleLoadExampleCsv() {
    startImportTransition(() => {
      const count = onImportCsvText(demoBankCsv);
      setCsvMessage(`${count} filas de ejemplo listas para revisar.`);
    });
  }

  return (
    <section className="panel" id="banco">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Banco</p>
          <h2>Conciliacion por CSV</h2>
        </div>
        <span>{isImporting ? "Procesando..." : "Listo para cargar"}</span>
      </div>

      <div className="bank-helper">
        <strong>Formato simple del CSV</strong>
        <p>Columnas sugeridas: fecha, referencia, cliente y monto.</p>
      </div>

      <div className="bank-actions">
        <label className="upload-button">
          Subir CSV
          <input accept=".csv,text/csv" onChange={handleCsvUpload} type="file" />
        </label>
        <button className="ghost-button" onClick={handleLoadExampleCsv} type="button">
          Cargar ejemplo
        </button>
      </div>

      <p className="bank-message">{csvMessage}</p>

      <div className="steps">
        <div>
          <strong>1</strong>
          <p>Subes el archivo del banco.</p>
        </div>
        <div>
          <strong>2</strong>
          <p>La app busca el cliente y detecta coincidencias.</p>
        </div>
        <div>
          <strong>3</strong>
          <p>Conciliamos o registramos el abono en un clic.</p>
        </div>
      </div>

      <div className="bank-list">
        {bankRows.length > 0 ? (
          bankRows.map((row) => (
            <BankRowItem
              key={row.id}
              clients={clients}
              onApply={onApply}
              onAssignClient={onAssignClient}
              row={row}
            />
          ))
        ) : (
          <EmptyBlock
            title="Sin filas del banco"
            body="Todavia no se ha cargado un archivo CSV."
          />
        )}
      </div>
    </section>
  );
}

export default BankPanel;
