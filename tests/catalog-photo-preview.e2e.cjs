const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.CATALOG_TEST_URL || "http://127.0.0.1:5173";
const photoPath = process.env.CATALOG_TEST_PHOTO;

if (!photoPath || !fs.existsSync(photoPath)) {
  throw new Error("Define CATALOG_TEST_PHOTO con una imagen existente.");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${baseUrl}/demo/catalogo-autos`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByRole("heading", { name: "Ficha del catálogo · A01", exact: true }).waitFor({ state: "visible" });
    if (await page.getByRole("tab", { name: "Datos del auto" }).count()) throw new Error("El catálogo todavía muestra la pestaña Datos del auto.");
    if (await page.getByRole("tab", { name: "Documentos" }).count()) throw new Error("El catálogo todavía muestra la pestaña Documentos.");
    await page.locator('input[type="file"]').setInputFiles(photoPath);

    const image = page.locator(".fleet-catalog-photo-editor img");
    await image.waitFor({ state: "visible" });
    await image.evaluate((element) => element.complete && element.naturalWidth > 0);

    const metrics = await image.evaluate((element) => {
      const imageStyle = getComputedStyle(element);
      const stage = element.parentElement;
      const imageRect = element.getBoundingClientRect();
      const stageRect = stage?.getBoundingClientRect();
      return {
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        stageWidth: stageRect?.width,
        stageHeight: stageRect?.height,
        objectFit: imageStyle.objectFit,
        objectPosition: imageStyle.objectPosition,
        imagePosition: imageStyle.position
      };
    });

    fs.mkdirSync(path.join(process.cwd(), "artifacts"), { recursive: true });
    const screenshotPath = path.join(process.cwd(), "artifacts", "catalog-photo-original-stage.png");
    await page.locator(".fleet-catalog-photo-editor").screenshot({ path: screenshotPath });

    console.log(JSON.stringify({ metrics, screenshotPath }, null, 2));

    if (metrics.naturalWidth <= 0 || metrics.naturalHeight <= 0) {
      throw new Error(`La imagen cargada no tiene dimensiones válidas: ${metrics.naturalWidth}x${metrics.naturalHeight}`);
    }
    if (metrics.objectFit !== "contain") {
      throw new Error(`Se esperaba object-fit contain, pero el navegador usa ${metrics.objectFit}.`);
    }
    if (metrics.imageHeight > metrics.stageHeight + 1 || metrics.imageWidth > metrics.stageWidth + 1) {
      throw new Error(`La imagen desborda la vista previa: imagen ${metrics.imageWidth}x${metrics.imageHeight}, contenedor ${metrics.stageWidth}x${metrics.stageHeight}.`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
