import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  extractFleetVehicleDataFromText,
  hasCoreFleetVehicleData,
  mergeFleetVehicleData,
  type FleetExtractedVehicleData
} from "./fleetVehicleDocumentParsing";

type FleetDocumentOcrProgress = {
  progress: number;
  fileName: string;
};

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function imageFileDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("No se pudo preparar la imagen."));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

async function renderFirstPdfPage(file: File): Promise<{ imageDataUrl: string; embeddedText: string }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const page = await pdfDocument.getPage(1);
    const textContent = await page.getTextContent();
    const embeddedText = textContent.items
      .map((item) => "str" in item ? String(item.str) : "")
      .filter(Boolean)
      .join("\n");
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 2300 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale: Math.max(1.6, scale) });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const imageDataUrl = canvas.toDataURL("image/png");
    canvas.width = 1;
    canvas.height = 1;
    return { imageDataUrl, embeddedText };
  } finally {
    await pdfDocument.cleanup();
  }
}

function documentPriority(file: File): number {
  const name = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (name.includes("revisado") || name.includes("inspeccion")) return 0;
  if (name.includes("registro") || name.includes("unico")) return 1;
  if (name.includes("panapass") || name.includes("panapas")) return 2;
  return 3;
}

export async function analyzeFleetVehicleDocuments(
  files: File[],
  onProgress?: (status: FleetDocumentOcrProgress) => void
): Promise<FleetExtractedVehicleData> {
  const orderedFiles = [...files].sort((left, right) => documentPriority(left) - documentPriority(right));
  let extracted: FleetExtractedVehicleData = {};
  let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;
  let activeFileIndex = 0;
  let activeBaseProgress = 0;
  let activeFileShare = 1;
  let activeFileName = "";

  try {
    for (activeFileIndex = 0; activeFileIndex < orderedFiles.length; activeFileIndex += 1) {
      const file = orderedFiles[activeFileIndex];
      const baseProgress = activeFileIndex / orderedFiles.length;
      const fileShare = 1 / orderedFiles.length;
      activeBaseProgress = baseProgress;
      activeFileShare = fileShare;
      activeFileName = file.name;
      onProgress?.({ progress: baseProgress + fileShare * 0.05, fileName: file.name });

      const prepared = isPdf(file)
        ? await renderFirstPdfPage(file)
        : { imageDataUrl: await imageFileDataUrl(file), embeddedText: "" };
      extracted = mergeFleetVehicleData(extracted, extractFleetVehicleDataFromText(prepared.embeddedText));
      if (hasCoreFleetVehicleData(extracted)) break;

      const tesseract = await import("tesseract.js");
      if (!worker) {
        worker = await tesseract.createWorker("eng", undefined, {
          logger: (message) => {
            if (typeof message.progress !== "number") return;
            onProgress?.({
              progress: Math.min(0.98, activeBaseProgress + activeFileShare * (0.08 + message.progress * 0.88)),
              fileName: activeFileName
            });
          }
        });
        await worker.setParameters({
          tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
          preserve_interword_spaces: "1"
        });
      }

      const recognition = await worker.recognize(prepared.imageDataUrl);
      extracted = mergeFleetVehicleData(extracted, extractFleetVehicleDataFromText(recognition.data.text));
      if (hasCoreFleetVehicleData(extracted)) break;
    }
    onProgress?.({
      progress: 1,
      fileName: orderedFiles[activeFileIndex]?.name ?? orderedFiles[orderedFiles.length - 1]?.name ?? ""
    });
    return extracted;
  } finally {
    await worker?.terminate();
  }
}
