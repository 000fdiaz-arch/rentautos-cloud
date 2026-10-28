import { useMemo, useState } from "react";

type DocumentKey = "registro" | "revisado" | "seguro" | "panapass";

type DocumentDefinition = {
  key: DocumentKey;
  icon: string;
  title: string;
  status: string;
  summary: string;
  fields: Array<[string, string]>;
};

const DOCUMENTS: DocumentDefinition[] = [
  {
    key: "registro",
    icon: "▣",
    title: "Registro único",
    status: "Verificado",
    summary: "Datos técnicos del vehículo",
    fields: [
      ["Número de registro", "6377894"],
      ["Municipio", "La Chorrera"],
      ["Mes de placa", "Enero"],
      ["Marca / modelo", "Hyundai Santa Fe"],
      ["Año", "2020"],
      ["Color", "Rojo"],
      ["Transmisión", "Automático"]
    ]
  },
  {
    key: "revisado",
    icon: "✓",
    title: "Revisado",
    status: "Vigente",
    summary: "Próxima inspección: 01 ene 2027",
    fields: [
      ["Certificado", "16635518"],
      ["Fecha de inspección", "16 mar 2026"],
      ["Próxima inspección", "01 ene 2027"],
      ["Aseguradora", "Fedpa"],
      ["Póliza indicada", "04-05-13784159-0"]
    ]
  },
  {
    key: "seguro",
    icon: "◆",
    title: "Seguro",
    status: "Revisar",
    summary: "Vence: 28 ene 2027",
    fields: [
      ["Póliza", "04-55-2107975-0"],
      ["Inicio de vigencia", "11 abr 2026"],
      ["Fin de vigencia", "28 ene 2027"],
      ["Total", "$584.48"],
      ["Placa", "DC5113"]
    ]
  },
  {
    key: "panapass",
    icon: "P",
    title: "Panapass",
    status: "Activo",
    summary: "Sticker identificado",
    fields: [
      ["Cuenta", "0001300024"],
      ["Sticker", "01321867"],
      ["Fecha de contrato", "20 abr 2026"],
      ["Placa", "DC5113"]
    ]
  }
];

type Props = {
  error?: string;
  onApply: () => void;
  onCancel: () => void;
};

export function FleetDocumentIntake({ error, onApply, onCancel }: Props) {
  const [selectedKey, setSelectedKey] = useState<DocumentKey>("seguro");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const selected = useMemo(() => DOCUMENTS.find((document) => document.key === selectedKey) ?? DOCUMENTS[0], [selectedKey]);

  function handleFiles(files: FileList | null) {
    const names = Array.from(files ?? []).map((file) => file.name);
    setSelectedFiles(names);
    setReady(names.length > 0);
  }

  return (
    <div className="fleet-doc-intake">
      <div className="fleet-doc-demo-upload">
        <div>
          <strong>Sube los documentos del auto</strong>
          <p>Admite PDF o fotografía. Puedes cargar Registro único, Revisado, Seguro y Panapass juntos.</p>
        </div>
        <label className="button primary fleet-doc-demo-upload-button">
          <span aria-hidden="true">＋</span> Elegir documentos
          <input
            type="file"
            accept="application/pdf,image/*"
            multiple
            onChange={(event) => handleFiles(event.target.files)}
          />
        </label>
      </div>

      {!ready && (
        <div className="fleet-doc-intake-empty">
          <span className="fleet-doc-intake-empty-icon" aria-hidden="true">▤</span>
          <div>
            <strong>Aquí comenzará el registro del auto</strong>
            <p>Al cargar los archivos, el sistema leerá los datos y te permitirá confirmarlos antes de crear la unidad.</p>
          </div>
          <button type="button" className="button ghost" onClick={() => { setReady(true); setSelectedFiles(["REGISTRO UNICO.pdf", "REVISADO.pdf", "SEGURO.pdf", "PANAPASS.pdf"]); }}>
            Probar con los documentos de ejemplo
          </button>
        </div>
      )}

      {ready && (
        <>
          <p className="fleet-doc-demo-file-note" role="status">
            ✓ {selectedFiles.length} documento{selectedFiles.length === 1 ? "" : "s"} analizado{selectedFiles.length === 1 ? "" : "s"}. Revisa los datos antes de continuar.
          </p>

          <div className="fleet-doc-demo-layout">
            <aside className="fleet-doc-demo-list" aria-label="Documentos detectados">
              <div className="fleet-doc-demo-list-title">
                <strong>Documentos detectados</strong>
                <span>4 de 4</span>
              </div>
              {DOCUMENTS.map((document) => (
                <button
                  type="button"
                  key={document.key}
                  className={`fleet-doc-demo-item ${selectedKey === document.key ? "is-selected" : ""}`}
                  onClick={() => setSelectedKey(document.key)}
                >
                  <span className="fleet-doc-demo-icon" aria-hidden="true">{document.icon}</span>
                  <span>
                    <strong>{document.title}</strong>
                    <small>{document.summary}</small>
                  </span>
                  <em className={document.key === "seguro" ? "is-warning" : ""}>{document.status}</em>
                </button>
              ))}
              <p className="fleet-doc-demo-private">🔒 Los archivos quedan privados y no aparecen en el catálogo público.</p>
            </aside>

            <section className="fleet-doc-demo-review">
              <div className="fleet-doc-demo-review-head">
                <div>
                  <span>LECTURA AUTOMÁTICA</span>
                  <h3>{selected.title}</h3>
                </div>
                <span className={`fleet-doc-demo-status ${selected.key === "seguro" ? "is-warning" : ""}`}>{selected.status}</span>
              </div>

              {selected.key === "seguro" && (
                <div className="fleet-doc-demo-alert" role="alert">
                  <strong>Hay un dato para confirmar</strong>
                  <span>La póliza del revisado no coincide con el certificado de seguro. No se reemplazará automáticamente.</span>
                  <div><b>Revisado:</b> 04-05-13784159-0 <b>Seguro:</b> 04-55-2107975-0</div>
                </div>
              )}

              <div className="fleet-doc-demo-fields">
                {selected.fields.map(([label, value]) => (
                  <label key={label}>{label}<input value={value} readOnly /></label>
                ))}
              </div>

              <div className="fleet-doc-demo-identity">
                <span><small>VIN / chasis</small><strong>KMHS281EBLU203445</strong></span>
                <span><small>Motor</small><strong>G4KEKD049968</strong></span>
              </div>
            </section>
          </div>
        </>
      )}

      {error && (
        <div className="fleet-doc-duplicate-alert" role="alert">
          <span aria-hidden="true">!</span>
          <div><strong>Este auto ya está registrado</strong><p>{error}</p></div>
        </div>
      )}

      <div className="modal-actions fleet-doc-demo-actions">
        <button type="button" className="button ghost" onClick={onCancel}>Cancelar</button>
        <button type="button" className="button primary" disabled={!ready} onClick={onApply}>
          Usar datos y continuar →
        </button>
      </div>
    </div>
  );
}
