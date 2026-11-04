import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  detectReceiptAmountFromText,
  detectReceiptDestination,
  detectReceiptPaymentChannel,
  type PortalPaymentChannel,
  type ReceiptAuthorizedDestination,
  type ReceiptAmountConfidence,
  type ReceiptDestinationStatus
} from "./receiptAmountDetection";

export type { PortalPaymentChannel, ReceiptAmountConfidence, ReceiptAuthorizedDestination, ReceiptDestinationStatus } from "./receiptAmountDetection";

export type ReceiptAnalysisResult = {
  amount: number | null;
  confidence: ReceiptAmountConfidence;
  paymentChannel: PortalPaymentChannel | null;
  paymentChannelConfidence: ReceiptAmountConfidence;
  destinationStatus: ReceiptDestinationStatus;
  destinationAccountLast4: string | null;
  destinationRecipient: string | null;
};

function analyzeRecognizedText(
  text: string,
  expectedAmount: number,
  authorizedDestinations: ReceiptAuthorizedDestination[]
): ReceiptAnalysisResult {
  const amount = detectReceiptAmountFromText(text, expectedAmount);
  const channel = detectReceiptPaymentChannel(text);
  const destination = detectReceiptDestination(text, authorizedDestinations);
  return {
    ...amount,
    paymentChannel: channel.paymentChannel,
    paymentChannelConfidence: channel.confidence,
    destinationStatus: destination.status,
    destinationAccountLast4: destination.accountLast4,
    destinationRecipient: destination.recipient
  };
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function preprocessReceiptHeader(dataUrl: string): Promise<string | null> {
  if (!dataUrl.startsWith("data:image/")) return null;
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo preparar la imagen para una segunda lectura."));
    image.src = dataUrl;
  });
  const sourceCanvas = window.document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * 0.55));
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) return null;
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  let minX = sourceCanvas.width;
  let minY = sourceCanvas.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < sourceCanvas.height; y += 2) {
    for (let x = 0; x < sourceCanvas.width; x += 2) {
      const offset = (y * sourceCanvas.width + x) * 4;
      const red = pixels.data[offset];
      const green = pixels.data[offset + 1];
      const blue = pixels.data[offset + 2];
      if (blue > red + 35 && blue > green + 20 && blue > 120) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  const padding = 12;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(sourceCanvas.width - cropX, maxX - minX + padding * 2);
  const cropHeight = Math.min(sourceCanvas.height - cropY, maxY - minY + padding * 2);
  const scale = Math.min(2, 1800 / cropWidth);
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  const headerPixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < headerPixels.data.length; offset += 4) {
    const luminance = headerPixels.data[offset] * 0.299 + headerPixels.data[offset + 1] * 0.587 + headerPixels.data[offset + 2] * 0.114;
    const value = luminance > 182 ? 0 : 255;
    headerPixels.data[offset] = value;
    headerPixels.data[offset + 1] = value;
    headerPixels.data[offset + 2] = value;
    headerPixels.data[offset + 3] = 255;
  }
  context.putImageData(headerPixels, 0, 0);
  const output = canvas.toDataURL("image/png");
  sourceCanvas.width = 1;
  sourceCanvas.height = 1;
  canvas.width = 1;
  canvas.height = 1;
  return output;
}

async function renderFirstPdfPage(dataUrl: string): Promise<{ imageDataUrl: string; embeddedText: string }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdfDocument = await pdfjs.getDocument({ data: dataUrlBytes(dataUrl) }).promise;
  try {
    const page = await pdfDocument.getPage(1);
    const textContent = await page.getTextContent();
    const embeddedText = textContent.items
      .map((item) => "str" in item ? String(item.str) : "")
      .filter(Boolean)
      .join("\n");
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 2400 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale: Math.max(1.5, scale) });
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

export async function analyzeReceiptAmount(
  dataUrl: string,
  expectedAmount: number,
  onProgress?: (progress: number) => void,
  authorizedDestinations: ReceiptAuthorizedDestination[] = []
): Promise<ReceiptAnalysisResult> {
  let imageDataUrl = dataUrl;
  if (dataUrl.startsWith("data:application/pdf")) {
    onProgress?.(0.08);
    const rendered = await renderFirstPdfPage(dataUrl);
    const embeddedResult = analyzeRecognizedText(rendered.embeddedText, expectedAmount, authorizedDestinations);
    if (embeddedResult.amount !== null && embeddedResult.confidence !== "low") {
      onProgress?.(1);
      return embeddedResult;
    }
    imageDataUrl = rendered.imageDataUrl;
  }

  const tesseract = await import("tesseract.js");
  let recognitionPass = 0;
  const { createWorker } = tesseract;
  const worker = await createWorker("eng", undefined, {
    logger: (message) => {
      if (typeof message.progress !== "number") return;
      const scaled = recognitionPass === 0
        ? 0.12 + message.progress * 0.43
        : 0.56 + message.progress * 0.42;
      onProgress?.(Math.max(0.12, Math.min(0.98, scaled)));
    }
  });
  try {
    const result = await worker.recognize(imageDataUrl);
    const firstDetection = analyzeRecognizedText(result.data.text, expectedAmount, authorizedDestinations);
    if (firstDetection.amount !== null && firstDetection.confidence === "high" && firstDetection.paymentChannelConfidence !== "low") {
      onProgress?.(1);
      return firstDetection;
    }
    const processedHeader = await preprocessReceiptHeader(imageDataUrl);
    if (processedHeader) {
      recognitionPass = 1;
      await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT });
      const headerResult = await worker.recognize(processedHeader);
      const combinedDetection = analyzeRecognizedText(`${headerResult.data.text}\n${result.data.text}`, expectedAmount, authorizedDestinations);
      onProgress?.(1);
      return combinedDetection;
    }
    onProgress?.(1);
    return firstDetection;
  } finally {
    await worker.terminate();
  }
}
