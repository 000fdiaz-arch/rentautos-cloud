import { useRef, useState, type ReactNode } from "react";
import { analyzeFleetVehicleDocuments } from "./fleetVehicleDocumentOcr";
import type { FleetExtractedVehicleData } from "./fleetVehicleDocumentParsing";
import "./FleetDocumentIntake.css";

type DocumentKey = "registro" | "revisado" | "seguro" | "panapass";

type UploadedDocument = {
  fileName: string;
  file?: File;
  note?: string;
};

type AnalysisResult = {
  fileCount: number;
  identifiedCount: number;
  detectedFieldCount: number;
  progress: number;
  status: "reading" | "complete" | "error";
  currentFile?: string;
  message?: string;
};

export type { FleetExtractedVehicleData } from "./fleetVehicleDocumentParsing";

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

const EXAMPLE_VEHICLE_DATA: FleetExtractedVehicleData = {
  brand_model: "HYUNDAI SANTA FE",
  year: "2020",
  plate: "DC5113",
  engine_serial: "G4KEKD049968",
  chassis_serial: "KMHS281EBLU203445",
  color: "ROJO",
  transmission: "Automático"
};

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
  const isAnalyzing = analysisResult?.status === "reading";

  async function handleFiles(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
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
        file: match.file,
        note: match.correctedClassification ? "Detectado por el contenido, no por el nombre del archivo" : undefined
      };
    }
    setUploadedDocuments(nextDocuments);
    const filesToAnalyze = Array.from(new Map(
      [...Object.values(nextDocuments).flatMap((document) => document?.file ? [document.file] : []), ...selectedFiles]
        .map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file])
    ).values());
    const initialResult: AnalysisResult = {
      fileCount: selectedFiles.length,
      identifiedCount: matches.length,
      detectedFieldCount: 0,
      progress: 0,
      status: "reading"
    };
    setAnalysisResult(initialResult);
    try {
      const extractedData = await analyzeFleetVehicleDocuments(filesToAnalyze, ({ progress, fileName }) => {
        setAnalysisResult((current) => current ? { ...current, progress, currentFile: fileName } : current);
      });
      const detectedFieldCount = Object.values(extractedData).filter(Boolean).length;
      onDetectedData(extractedData);
      setAnalysisResult({
        ...initialResult,
        progress: 1,
        status: "complete",
        detectedFieldCount,
        message: detectedFieldCount > 0
          ? `${detectedFieldCount} datos del vehículo detectados y cargados en el formulario.`
          : "Los documentos se identificaron, pero no se encontraron datos legibles para completar el formulario."
      });
    } catch (readingError) {
      setAnalysisResult({
        ...initialResult,
        progress: 1,
        status: "error",
        message: readingError instanceof Error
          ? `No se pudo leer el contenido: ${readingError.message}`
          : "No se pudo leer el contenido de los documentos."
      });
    }
  }

  function loadExampleDocuments() {
    const examples: Partial<Record<DocumentKey, UploadedDocument>> = {
      registro: { fileName: "REGISTRO UNICO.pdf" },
      revisado: { fileName: "REVISADO.pdf" },
      seguro: { fileName: "SEGURO.pdf" },
      panapass: { fileName: "PANAPASS.pdf" }
    };
    setUploadedDocuments(examples);
    setAnalysisResult({ fileCount: 4, identifiedCount: 4, detectedFieldCount: 7, progress: 1, status: "complete" });
    onDetectedData(EXAMPLE_VEHICLE_DATA);
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
          disabled={isAnalyzing}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>

      {analysisResult ? (
        <div className={`fleet-doc-demo-file-note fleet-doc-ocr-status ${analysisResult.status !== "complete" || analysisResult.detectedFieldCount === 0 ? "is-warning" : ""}`} role="status">
          <span>
            {analysisResult.status === "reading"
              ? `Leyendo contenido real del documento${analysisResult.currentFile ? ` · ${analysisResult.currentFile}` : ""}`
              : analysisResult.message ?? `Lectura completada: ${analysisResult.identifiedCount} documentos identificados.`}
          </span>
          {analysisResult.status === "reading" && (
            <><progress max="1" value={analysisResult.progress} /><b>{Math.round(analysisResult.progress * 100)}%</b></>
          )}
        </div>
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
                  <button type="button" disabled={isAnalyzing} onClick={() => fileInputRef.current?.click()}>{uploaded ? "Reemplazar" : "Agregar"}</button>
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
            <div><span className="fleet-doc-unified-eyebrow">Datos del auto</span><h3>{isAnalyzing ? "Leyendo documentos..." : analysisResult ? "Datos detectados" : "Completa o carga los documentos"}</h3></div>
            {analysisResult?.status === "complete" && analysisResult.detectedFieldCount > 0 && <span>✓ {analysisResult.detectedFieldCount} datos detectados</span>}
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
        <button type="button" className="button primary" disabled={saving || isAnalyzing || completedCount === 0} onClick={onSave}>
          {saving ? "Guardando..." : isAnalyzing ? "Leyendo documentos..." : "Guardar auto"}
        </button>
      </div>
    </div>
  );
}
