import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extractLeadIdentityDocumentData, type LeadIdentityDocumentData } from "./leadIdentityDocumentParsing";

export type LeadIdentityOcrProgress = {
  progress: number;
  message: string;
};

type IdentityDocumentSource = {
  dataUrl: string;
  mime: string;
  name: string;
};

function dataUrlBytes(dataUrl: string): Uint8Array {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function renderFirstPdfPage(dataUrl: string): Promise<{ imageDataUrl: string; embeddedText: string }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdfDocument = await pdfjs.getDocument({ data: dataUrlBytes(dataUrl) }).promise;
  try {
    const page = await pdfDocument.getPage(1);
    const content = await page.getTextContent();
    const embeddedText = content.items
      .map((item) => "str" in item ? String(item.str) : "")
      .filter(Boolean)
      .join("\n");
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 2400 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale: Math.max(1.8, scale) });
    const canvas = document.createElement("canvas");
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

async function prepareImage(dataUrl: string): Promise<string> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo preparar la imagen para leerla."));
    image.src = dataUrl;
  });
  const scale = Math.min(3, Math.max(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Este navegador no puede preparar la imagen.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const prepared = canvas.toDataURL("image/png");
  canvas.width = 1;
  canvas.height = 1;
  return prepared;
}

type IdentityNumberRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const identityNumberRegions: IdentityNumberRegion[] = [
  // Licencia actual: la cédula aparece debajo del encabezado, hacia el centro-izquierda.
  { x: 0.18, y: 0.18, width: 0.42, height: 0.25 },
  // Licencia antigua: la cédula está más cerca del borde izquierdo y un poco más abajo.
  { x: 0.05, y: 0.28, width: 0.4, height: 0.24 }
];

async function cropIdentityNumberRegion(dataUrl: string, region: IdentityNumberRegion): Promise<string> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo preparar la zona de la cédula."));
    image.src = dataUrl;
  });
  const sourceX = Math.round(image.naturalWidth * region.x);
  const sourceY = Math.round(image.naturalHeight * region.y);
  const sourceWidth = Math.round(image.naturalWidth * region.width);
  const sourceHeight = Math.round(image.naturalHeight * region.height);
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = Math.round(canvas.width * sourceHeight / sourceWidth);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Este navegador no puede preparar la zona de la cédula.");
  context.filter = "grayscale(1) contrast(2)";
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const prepared = canvas.toDataURL("image/png");
  canvas.width = 1;
  canvas.height = 1;
  return prepared;
}

function completeCedulaFromFocusedRead(fullText: string, focusedText: string): string {
  const focusedData = extractLeadIdentityDocumentData(focusedText);
  if (focusedData.cedula) return focusedData.cedula;
  const partial = focusedText.match(/(?:^|[^0-9])([0-9]{2,4})\s*[-–—]\s*([0-9]{3,6})(?![0-9])/);
  if (!partial) return "";
  const beforeFirstDate = fullText.split(/\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}/, 1)[0];
  const prefixes = Array.from(beforeFirstDate.matchAll(/(?:^|\s)([1-9]|1[0-3])(?=\s|$)/g));
  const prefix = prefixes[prefixes.length - 1]?.[1] ?? "";
  return prefix ? `${prefix}-${partial[1]}-${partial[2]}` : "";
}

async function rotatedImageVariants(dataUrl: string): Promise<Array<{ degrees: number; dataUrl: string }>> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo preparar la orientación del documento."));
    image.src = dataUrl;
  });
  return [0, 90, 180, 270].map((degrees) => {
    if (degrees === 0) return { degrees, dataUrl };
    const swapsSides = degrees === 90 || degrees === 270;
    const canvas = document.createElement("canvas");
    canvas.width = swapsSides ? image.naturalHeight : image.naturalWidth;
    canvas.height = swapsSides ? image.naturalWidth : image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Este navegador no puede rotar el documento.");
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(degrees * Math.PI / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const rotated = canvas.toDataURL("image/png");
    canvas.width = 1;
    canvas.height = 1;
    return { degrees, dataUrl: rotated };
  });
}

function normalizedReadText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function hasIdentityLabels(value: string): boolean {
  const text = normalizedReadText(value);
  return /LICEN(?:CIA|SE)|DRIVER|FECHA\s+DE\s+NACIMIENTO|DATE\s+OF\s+BIRTH|NACIONALIDAD|NATIONALITY/.test(text);
}

function usesLegacyLicenseLayout(value: string): boolean {
  const text = normalizedReadText(value);
  return /AUTORIDAD|TRANSPORTE\s+TERRESTRE/.test(text) && !/\bNAME\b|\bNOMB[A-Z]{1,4}\b/.test(text);
}

function identityReadScore(data: LeadIdentityDocumentData, text: string): number {
  let score = 0;
  if (data.cedula) score += 12;
  if (data.birthDate) score += 10;
  if (data.cedula && data.birthDate) score += 6;
  if (hasIdentityLabels(text)) score += 6;
  const normalized = normalizedReadText(text);
  if (/REPUBLICA\s+DE\s+PANAMA/.test(normalized)) score += 2;
  if (/EXPIRACION|EXPIRES/.test(normalized)) score += 1;
  return score;
}

export async function analyzeLeadIdentityDocument(
  source: IdentityDocumentSource,
  onProgress?: (status: LeadIdentityOcrProgress) => void
): Promise<LeadIdentityDocumentData> {
  onProgress?.({ progress: 0.05, message: "Preparando el documento" });
  const isPdf = source.mime === "application/pdf" || source.name.toLowerCase().endsWith(".pdf");
  const prepared = isPdf
    ? await renderFirstPdfPage(source.dataUrl)
    : { imageDataUrl: await prepareImage(source.dataUrl), embeddedText: "" };
  const embedded = extractLeadIdentityDocumentData(prepared.embeddedText);
  if (embedded.cedula && embedded.birthDate) {
    onProgress?.({ progress: 1, message: "Datos detectados" });
    return embedded;
  }

  const tesseract = await import("tesseract.js");
  let recognitionBase = 0.1;
  let recognitionSpan = 0.18;
  let progressMessage = "Preparando lectura";
  const worker = await tesseract.createWorker("eng", undefined, {
    logger: (message) => {
      if (typeof message.progress !== "number") return;
      onProgress?.({
        progress: Math.min(0.98, recognitionBase + message.progress * recognitionSpan),
        message: message.status === "recognizing text" ? progressMessage : "Preparando lectura"
      });
    }
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      tessedit_char_whitelist: ""
    });
    const orientations = await rotatedImageVariants(prepared.imageDataUrl);
    let bestRead: { imageDataUrl: string; fullText: string; data: LeadIdentityDocumentData; score: number; focused: boolean } | null = null;

    async function readFocusedCedula(read: NonNullable<typeof bestRead>, progress: number): Promise<void> {
      if (read.focused || read.data.cedula) return;
      read.focused = true;
      recognitionBase = progress;
      recognitionSpan = 0.04;
      progressMessage = "Confirmando el número de cédula";
      onProgress?.({ progress, message: progressMessage });
      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: "0123456789-"
      });
      const focusedTexts: string[] = [];
      const regions = usesLegacyLicenseLayout(read.fullText)
        ? identityNumberRegions
        : identityNumberRegions.slice(0, 1);
      for (const region of regions) {
        const identityNumberRegion = await cropIdentityNumberRegion(read.imageDataUrl, region);
        const focusedRecognition = await worker.recognize(identityNumberRegion);
        focusedTexts.push(focusedRecognition.data.text);
        read.data.cedula = completeCedulaFromFocusedRead(read.fullText, focusedRecognition.data.text);
        if (read.data.cedula) break;
      }
      const focusedText = focusedTexts.join("\n");
      if (!read.data.cedula) read.data.cedula = completeCedulaFromFocusedRead(read.fullText, focusedText);
      read.score = identityReadScore(read.data, `${read.fullText}\n${focusedText}`);
      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: ""
      });
    }

    for (const [index, orientation] of orientations.entries()) {
      const orientationProgress = 0.1 + index * 0.2;
      recognitionBase = orientationProgress;
      recognitionSpan = 0.16;
      progressMessage = `Probando orientación ${index + 1} de ${orientations.length}`;
      onProgress?.({ progress: orientationProgress, message: progressMessage });
      const recognition = await worker.recognize(orientation.dataUrl);
      const fullText = `${prepared.embeddedText}\n${recognition.data.text}`;
      const read = {
        imageDataUrl: orientation.dataUrl,
        fullText,
        data: extractLeadIdentityDocumentData(fullText),
        score: 0,
        focused: false
      };
      read.score = identityReadScore(read.data, fullText);

      if (!read.data.cedula && read.data.birthDate && hasIdentityLabels(fullText)) {
        await readFocusedCedula(read, orientationProgress + 0.16);
      }
      if (!bestRead || read.score > bestRead.score) bestRead = read;
      if (read.data.cedula && read.data.birthDate && hasIdentityLabels(fullText)) {
        bestRead = read;
        break;
      }
    }

    if (bestRead && !bestRead.data.cedula) await readFocusedCedula(bestRead, 0.92);
    onProgress?.({ progress: 1, message: "Lectura completada" });
    return bestRead?.data ?? embedded;
  } finally {
    await worker.terminate();
  }
}
