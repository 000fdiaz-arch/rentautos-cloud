const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2400;

const MIME_BY_EXTENSION = new Map([
  ["pdf", "application/pdf"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["heic", "image/heic"],
  ["heif", "image/heif"]
]);

const DIRECT_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const HEIC_MIMES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export type PreparedSellerLeadDocument = {
  name: string;
  dataUrl: string;
  optimized: boolean;
};

function fileExtension(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}
export function sellerLeadDocumentMime(file: Pick<File, "name" | "type">): string | null {
  const declared = file.type.trim().toLowerCase().split(";", 1)[0];
  if (declared === "image/jpg") return "image/jpeg";
  if (DIRECT_MIMES.has(declared) || HEIC_MIMES.has(declared)) return declared;
  return MIME_BY_EXTENSION.get(fileExtension(file.name)) ?? null;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer el documento."));
    reader.readAsDataURL(blob);
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("No se pudo optimizar la foto.")), "image/jpeg", quality);
  });
}

async function compressImage(blob: Blob): Promise<Blob> {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("El teléfono entregó una imagen que no se pudo leer."));
      image.src = objectUrl;
    });
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
    if (!longestEdge) throw new Error("La foto no contiene una imagen válida.");

    let scale = Math.min(1, MAX_IMAGE_EDGE / longestEdge);
    let quality = 0.88;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Este navegador no puede optimizar la foto.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const compressed = await canvasToJpeg(canvas, quality);
      canvas.width = 1;
      canvas.height = 1;
      if (compressed.size <= MAX_DOCUMENT_BYTES) return compressed;
      if (quality > 0.58) quality -= 0.1;
      else scale *= 0.8;
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  throw new Error("La foto sigue siendo demasiado grande después de optimizarla.");
}

async function convertHeic(file: File): Promise<Blob> {
  try {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    return Array.isArray(converted) ? converted[0] : converted;
  } catch {
    throw new Error("No se pudo convertir la foto HEIC/HEIF. Intenta tomar una captura de pantalla y adjuntarla.");
  }
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim() || "documento";
  return `${base}.jpg`.slice(0, 240);
}

export async function prepareSellerLeadDocument(file: File): Promise<PreparedSellerLeadDocument> {
  if (file.size === 0) throw new Error("El archivo seleccionado está vacío.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("El archivo seleccionado supera 25 MB. Selecciona uno más pequeño.");

  const mime = sellerLeadDocumentMime(file);
  if (!mime) throw new Error("Adjunta una foto, imagen o PDF válido.");
  if (mime === "application/pdf") {
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error("El PDF debe pesar 4 MB o menos.");
    return { name: file.name.slice(0, 240), dataUrl: await readBlobAsDataUrl(new Blob([file], { type: mime })), optimized: false };
  }

  const heic = HEIC_MIMES.has(mime);
  let output: Blob = heic ? await convertHeic(file) : new Blob([file], { type: mime });
  let optimized = heic;
  if (output.size > MAX_DOCUMENT_BYTES) {
    output = await compressImage(output);
    optimized = true;
  }
  if (output.size === 0 || output.size > MAX_DOCUMENT_BYTES) {
    throw new Error("No se pudo reducir la foto a 4 MB. Intenta con otra imagen.");
  }
  return {
    name: optimized ? jpegName(file.name) : file.name.slice(0, 240),
    dataUrl: await readBlobAsDataUrl(output),
    optimized
  };
}
