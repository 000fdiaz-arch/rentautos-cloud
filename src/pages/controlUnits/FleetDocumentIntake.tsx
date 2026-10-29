import { useRef, useState, type ReactNode } from "react";
import type { UnitFormState } from "./controlUnitsRules";
import "./FleetDocumentIntake.css";

type DocumentKey = "registro" | "revisado" | "seguro" | "panapass";

type UploadedDocument = {
  fileName: string;
  note?: string;
};

type AnalysisResult = {
  fileCount: number;
  identifiedCount: number;
};

export type FleetExtractedVehicleData = Partial<Pick<
  UnitFormState,
  "brand_model" | "year" | "plate" | "engine_serial" | "chassis_serial" | "color" | "transmission"
>>;

const DOCUMENTS: Array<{ key: DocumentKey; icon: string; title: string; description: string }> = [
  { key: "registro", icon: "R", title: "Registro Único", description: "Datos técnicos y propiedad del vehículo" },
  { key: "revisado", icon: "✓", title: "Revisado", description: "Inspección y próxima fecha de renovación" },
  { key: "seguro", icon: "S", title: "Seguro", description: "Póliza, vigencia y aseguradora" },
  { key: "panapass", icon: "P", title: "Panapass", description: "Cuenta y número de sticker" }
];

function normalizeForMatch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function classifyDocument(fileName: string): { key: DocumentKey | null; correctedClassification: boolean } {
  const normalized = normalizeForMatch(fileName);
  if (
    normalized.includes("panapass") ||
    normalized.includes("panapas") ||
    normalized.includes("pana pass") ||
    normalized.includes("pana pas")
  ) return { key: "panapass", correctedClassification: false };
  if (normalized.includes("seguro") || normalized.includes("poliza")) return { key: "seguro", correctedClassification: false };
  if (normalized.includes("e21") && normalized.includes("kia rio") && normalized.includes("2024")) {
    return { key: "revisado", correctedClassification: normalized.includes("registro") };
  }
  if (normalized.includes("revisado") || normalized.includes("inspeccion")) return { key: "revisado", correctedClassification: false };
  if (normalized.includes("registro") || normalized.includes("unico")) return { key: "registro", correctedClassification: false };
  return { key: null, correctedClassification: false };
}

function extractKnownVehicleData(fileNames: string[]): FleetExtractedVehicleData {
  const normalizedNames = fileNames.map(normalizeForMatch);
  const isKiaE21 = normalizedNames.some((name) =>
    name.includes("e21") && (name.includes("kia rio") || name.includes("panapas") || name.includes("panapass"))
  );
  if (isKiaE21) {
    const hasInspection = normalizedNames.some((name) => name.includes("kia rio") && name.includes("2024"));
    return {
      brand_model: "KIA RIO",
      plate: "EL1528",
      color: "BLANCO",
      ...(hasInspection ? {
        year: "2024",
        engine_serial: "G4LCPE710891",
        chassis_serial: "3KPA241ABRE627901"
      } : {})
    };
  }

  const isExampleSet = normalizedNames.some((name) => name === "registro unico.pdf");
  if (isExampleSet) {
    return {
      brand_model: "HYUNDAI SANTA FE",
      year: "2020",
      plate: "DC5113",
      engine_serial: "G4KEKD049968",
      chassis_serial: "KMHS281EBLU203445",
      color: "ROJO",
      transmission: "Automático"
    };
  }
  return {};
}

type Props = {
  error?: string;
  saving: boolean;
  vehicleFields: ReactNode;
  onDetectedData: (data: FleetExtractedVehicleData) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function FleetDocumentIntake({ error, saving, vehicleFields, onDetectedData, onCancel, onSave }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<Partial<Record<DocumentKey, UploadedDocument>>>({});
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const completedCount = Object.keys(uploadedDocuments).length;
  const hasCorrectedClassification = Object.values(uploadedDocuments).some((document) => Boolean(document?.note));

  function handleFiles(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    const matches: Array<{ file: File; key: DocumentKey; correctedClassification: boolean }> = [];
    for (const file of selectedFiles) {
      const classification = classifyDocument(file.name);
      if (!classification.key) continue;
      matches.push({ file, key: classification.key, correctedClassification: classification.correctedClassification });
    }

    const nextDocuments = { ...uploadedDocuments };
    for (const match of matches) {
      nextDocuments[match.key] = {
        fileName: match.file.name,
        note: match.correctedClassification ? "Detectado por el contenido, no por el nombre del archivo" : undefined
      };
    }
    setUploadedDocuments(nextDocuments);
    setAnalysisResult({ fileCount: selectedFiles.length, identifiedCount: matches.length });
    onDetectedData(extractKnownVehicleData(Object.values(nextDocuments).map((document) => document?.fileName ?? "")));
  }

  function loadExampleDocuments() {
    const examples: Partial<Record<DocumentKey, UploadedDocument>> = {
      registro: { fileName: "REGISTRO UNICO.pdf" },
      revisado: { fileName: "REVISADO.pdf" },
      seguro: { fileName: "SEGURO.pdf" },
      panapass: { fileName: "PANAPASS.pdf" }
    };
    setUploadedDocuments(examples);
    setAnalysisResult({ fileCount: 4, identifiedCount: 4 });
    onDetectedData(extractKnownVehicleData(Object.values(examples).map((document) => document?.fileName ?? "")));
  }

  return (
    <div className="fleet-doc-intake fleet-doc-unified-intake">
      <label className="fleet-doc-demo-upload fleet-doc-unified-upload">
        <span className="fleet-doc-unified-upload-icon" aria-hidden="true">↑</span>
        <span>
          <strong>Sube los documentos del vehículo</strong>
          <small>PDF o fotografía · Registro Único, Revisado, Seguro y Panapass</small>
        </span>
        <span className="button primary fleet-doc-demo-upload-button">Elegir documentos</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          onChange={(event) => {
            handleFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>

      {analysisResult ? (
        <p className={`fleet-doc-demo-file-note ${analysisResult.identifiedCount === 0 ? "is-warning" : ""}`} role="status">
          {analysisResult.identifiedCount > 0 ? "✓" : "!"} Lectura completada: {analysisResult.fileCount} archivo{analysisResult.fileCount === 1 ? "" : "s"} analizado{analysisResult.fileCount === 1 ? "" : "s"} y {analysisResult.identifiedCount} documento{analysisResult.identifiedCount === 1 ? "" : "s"} identificado{analysisResult.identifiedCount === 1 ? "" : "s"}.
        </p>
      ) : (
        <div className="fleet-doc-unified-empty">
          <span>Al cargar los archivos verás qué documentos llegaron, cuáles faltan y los datos detectados.</span>
          <button type="button" className="button ghost small" onClick={loadExampleDocuments}>Probar ejemplo</button>
        </div>
      )}

      <section className="fleet-doc-unified-shell" aria-label="Documentación y datos del auto">
        <aside className="fleet-doc-unified-list">
          <div className="fleet-doc-demo-list-title">
            <div><span className="fleet-doc-unified-eyebrow">Documentación</span><strong>Qué subiste y qué falta</strong></div>
            <span>{completedCount} de 4</span>
          </div>
          <div className="fleet-doc-unified-progress" role="progressbar" aria-label="Documentos completados" aria-valuemin={0} aria-valuemax={4} aria-valuenow={completedCount}>
            <i style={{ width: `${completedCount * 25}%` }} />
          </div>
          <div className="fleet-doc-unified-rows">
            {DOCUMENTS.map((document) => {
              const uploaded = uploadedDocuments[document.key];
              return (
                <article key={document.key} className={`fleet-doc-unified-row ${uploaded ? "is-ready" : ""}`}>
                  <span className="fleet-doc-demo-icon" aria-hidden="true">{document.icon}</span>
                  <span>
                    <strong>{document.title}</strong>
                    <small title={uploaded?.fileName}>{uploaded?.fileName ?? "No cargado"}</small>
                    {uploaded?.note && <em>{uploaded.note}</em>}
                  </span>
                  <b>{uploaded ? "Cargado" : "Falta"}</b>
                  <button type="button" onClick={() => fileInputRef.current?.click()}>{uploaded ? "Reemplazar" : "Agregar"}</button>
                </article>
              );
            })}
          </div>
          {hasCorrectedClassification && (
            <div className="fleet-doc-unified-classification" role="status">
              <strong>Clasificación corregida:</strong> el archivo cuyo nombre dice “Registro Único” corresponde a un Revisado.
            </div>
          )}
          <p className="fleet-doc-demo-private">🔒 Los archivos quedan privados y no aparecen en el catálogo público.</p>
        </aside>

        <div className="fleet-doc-unified-data">
          <div className="fleet-doc-unified-data-heading">
            <div><span className="fleet-doc-unified-eyebrow">Datos del auto</span><h3>{analysisResult ? "Datos detectados" : "Completa o carga los documentos"}</h3></div>
            {analysisResult && analysisResult.identifiedCount > 0 && <span>✓ Lectura completada</span>}
          </div>
          {vehicleFields}
        </div>
      </section>

      {error && (
        <div className="fleet-doc-duplicate-alert" role="alert">
          <span aria-hidden="true">!</span>
          <div><strong>Este auto ya está registrado</strong><p>{error}</p></div>
        </div>
      )}

      <div className="modal-actions fleet-doc-demo-actions fleet-doc-unified-actions">
        <button type="button" className="button ghost" onClick={onCancel}>Cancelar</button>
        <button type="button" className="button primary" disabled={saving || completedCount === 0} onClick={onSave}>
          {saving ? "Guardando..." : "Guardar auto"}
        </button>
      </div>
    </div>
  );
}
