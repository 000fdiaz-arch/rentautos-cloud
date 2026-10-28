import { useState } from "react";

type DocumentKey = "registro" | "revisado" | "seguro" | "panapass";

const DOCUMENT_TYPES: Array<{ key: DocumentKey; icon: string; title: string; description: string }> = [
  { key: "registro", icon: "▣", title: "Registro único", description: "Datos técnicos y propiedad del vehículo" },
  { key: "revisado", icon: "✓", title: "Revisado", description: "Inspección y próxima fecha de renovación" },
  { key: "seguro", icon: "◆", title: "Seguro", description: "Póliza, vigencia y aseguradora" },
  { key: "panapass", icon: "P", title: "Panapass", description: "Cuenta y número de sticker" }
];

type Props = {
  unitId: string;
};

export function FleetDocumentsPanel({ unitId }: Props) {
  const [files, setFiles] = useState<Partial<Record<DocumentKey, File>>>({});
  const attachedCount = Object.keys(files).length;

  return (
    <div className="fleet-documents-panel">
      <div className="fleet-documents-panel-head">
        <div>
          <h3>Documentos del auto {unitId}</h3>
          <p className="hint">Adjunta PDF o fotografía. Cada documento tendrá su lectura automática y sus alertas de vencimiento.</p>
        </div>
        <span>{attachedCount} de 4 adjuntos</span>
      </div>

      <div className="fleet-document-slots">
        {DOCUMENT_TYPES.map((document) => {
          const file = files[document.key];
          return (
            <article className={`fleet-document-slot ${file ? "has-file" : ""}`} key={document.key}>
              <span className="fleet-document-slot-icon" aria-hidden="true">{document.icon}</span>
              <div className="fleet-document-slot-info">
                <strong>{document.title}</strong>
                <small>{document.description}</small>
                {file ? <em title={file.name}>{file.name}</em> : <em>Sin documento adjunto</em>}
              </div>
              <label className={`button small ${file ? "ghost" : "primary"}`}>
                {file ? "Reemplazar" : "Adjuntar"}
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                  capture="environment"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0];
                    if (nextFile) setFiles((current) => ({ ...current, [document.key]: nextFile }));
                  }}
                />
              </label>
            </article>
          );
        })}
      </div>

      <div className="fleet-documents-note">
        <span aria-hidden="true">🔒</span>
        <div><strong>Documentos privados</strong><p>No se mostrarán en el catálogo público. En esta demo la selección se mantiene mientras la ficha esté abierta; el guardado permanente se habilitará al aplicar la migración documental.</p></div>
      </div>
    </div>
  );
}
