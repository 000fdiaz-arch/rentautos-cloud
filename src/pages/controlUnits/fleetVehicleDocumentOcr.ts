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

async function cropTransmissionRegion(imageDataUrl: string): Promise<string> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo preparar la zona de transmisión del Registro Único."));
    image.src = imageDataUrl;
  });
  const cropX = Math.round(image.naturalWidth * 0.04);
  const cropY = Math.round(image.naturalHeight * 0.405);
  const cropWidth = Math.round(image.naturalWidth * 0.21);
  const cropHeight = Math.round(image.naturalHeight * 0.03);
  const scale = Math.min(3, 1800 / cropWidth);
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la lectura de transmisión.");
  context.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const red = pixels.data[offset];
    const green = pixels.data[offset + 1];
    const blue = pixels.data[offset + 2];
    if (red > 120 && red > green + 18 && red > blue + 18) {
      pixels.data[offset] = 255;
      pixels.data[offset + 1] = 255;
      pixels.data[offset + 2] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const croppedDataUrl = canvas.toDataURL("image/png");
  canvas.width = 1;
  canvas.height = 1;
  return croppedDataUrl;
}

function isRegistrationFile(file: File): boolean {
  const name = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return name.includes("registro") || name.includes("unico");
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
  const shouldStopAfter = (fileIndex: number): boolean => hasCoreFleetVehicleData(extracted) && (
    Boolean(extracted.transmission) ||
    !orderedFiles.slice(fileIndex + 1).some(isRegistrationFile)
  );

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
      if (shouldStopAfter(activeFileIndex) && !(isRegistrationFile(file) && !extracted.transmission)) break;

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

      const onlyTransmissionIsMissing = isRegistrationFile(file) &&
        hasCoreFleetVehicleData(extracted) &&
        !extracted.transmission;
      if (!onlyTransmissionIsMissing) {
        const recognition = await worker.recognize(prepared.imageDataUrl);
        extracted = mergeFleetVehicleData(extracted, extractFleetVehicleDataFromText(recognition.data.text));
      }
      if (isRegistrationFile(file) && !extracted.transmission) {
        const transmissionRegion = await cropTransmissionRegion(prepared.imageDataUrl);
        await worker.setParameters({
          tessedit_pageseg_mode: tesseract.PSM.SINGLE_LINE,
          preserve_interword_spaces: "1"
        });
        const focusedRecognition = await worker.recognize(transmissionRegion);
        extracted = mergeFleetVehicleData(
          extracted,
          extractFleetVehicleDataFromText(focusedRecognition.data.text)
        );
        await worker.setParameters({
          tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
          preserve_interword_spaces: "1"
        });
      }
      if (shouldStopAfter(activeFileIndex)) break;
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
