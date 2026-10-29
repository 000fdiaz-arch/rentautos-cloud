import type { UnitFormState } from "./controlUnitsRules";

export type FleetExtractedVehicleData = Partial<Pick<
  UnitFormState,
  "brand_model" | "year" | "plate" | "engine_serial" | "chassis_serial" | "color" | "transmission"
>>;

function normalizeOcrText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .toUpperCase();
}

function cleanCode(value: string): string {
  return value.replace(/[^A-Z0-9-]/g, "").replace(/-/g, "");
}

function cleanWords(value: string): string {
  return value
    .replace(/[^A-Z0-9 /.-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[ ./-]+$/g, "")
    .trim();
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function normalizeTransmission(value: string): string {
  if (/AUTOM/.test(value)) return "Automático";
  if (/MANUAL|MECAN/.test(value)) return "Manual";
  return "";
}

export function extractFleetVehicleDataFromText(rawText: string): FleetExtractedVehicleData {
  const text = normalizeOcrText(rawText);
  const brand = cleanWords(firstMatch(text, [/(?:^|\n)\s*MARCA\s*:\s*([^\n]{2,30})/m]));
  const model = cleanWords(firstMatch(text, [/(?:^|\n)\s*MODELO\s*:\s*([^\n]{1,30})/m]));
  const plate = cleanCode(firstMatch(text, [
    /(?:^|\n)\s*PLACA(?:\s+UNICA)?\s*:\s*([A-Z]{1,3}\s*-?\s*\d{3,6})\b/m,
    /(?:^|\n)\s*(?:NO\.?\s+DE\s+)?PLACA\s*:\s*([A-Z]{1,3}\s*-?\s*\d{3,6})\b/m
  ]));
  const chassis = cleanCode(firstMatch(text, [
    /(?:NUMERO|NO\.?)\s+DE\s+CHASIS\s*:\s*([A-HJ-NPR-Z0-9 -]{12,24})/,
    /\bVIN(?:\s*\([^)]*\))?\s*:\s*([A-HJ-NPR-Z0-9 -]{12,24})/
  ]));
  const engine = cleanCode(firstMatch(text, [
    /(?:NUMERO|NO\.?)\s+DE\s+MOTOR\s*:\s*([A-Z0-9 -]{5,24})/
  ]));
  const year = firstMatch(text, [/(?:^|\n)\s*A[NÑ]O\s*:\s*((?:19|20)\d{2})\b/m]);
  const color = cleanWords(firstMatch(text, [/(?:^|\n)\s*COLOR\s*:\s*([A-Z ]{2,24})/m]));
  const transmission = normalizeTransmission(firstMatch(text, [
    /(?:^|\n)\s*(?:TIPO\s+DE\s+)?TRANSMISION\s*:\s*([^\n]{3,24})/m
  ]));

  const result: FleetExtractedVehicleData = {};
  const brandModel = [brand, model].filter(Boolean).join(" ");
  if (brandModel) result.brand_model = brandModel;
  if (year) result.year = year;
  if (plate) result.plate = plate;
  if (engine) result.engine_serial = engine;
  if (chassis) result.chassis_serial = chassis;
  if (color) result.color = color;
  if (transmission) result.transmission = transmission;
  return result;
}

export function mergeFleetVehicleData(
  current: FleetExtractedVehicleData,
  incoming: FleetExtractedVehicleData
): FleetExtractedVehicleData {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value && !merged[key as keyof FleetExtractedVehicleData]) {
      Object.assign(merged, { [key]: value });
    }
  }
  return merged;
}

export function hasCoreFleetVehicleData(data: FleetExtractedVehicleData): boolean {
  return Boolean(
    data.brand_model &&
    data.year &&
    data.plate &&
    data.engine_serial &&
    data.chassis_serial &&
    data.color
  );
}
