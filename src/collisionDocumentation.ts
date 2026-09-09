export type CollisionDocumentationSource = {
  incidentDate?: string | null;
  incidentLocation?: string | null;
  unit?: string | null;
  driver?: string | null;
  plate?: string | null;
  vehicleDamage?: string | null;
  trialDate?: string | null;
  ticketStub?: string | null;
  placeTime?: string | null;
  court?: string | null;
};

export type CollisionDocumentationRequirement = {
  key: keyof CollisionDocumentationSource;
  label: string;
};

export const COLLISION_DOCUMENTATION_REQUIREMENTS: CollisionDocumentationRequirement[] = [
  { key: "incidentDate", label: "Fecha de la colisión" },
  { key: "unit", label: "Unidad" },
  { key: "driver", label: "Conductor" },
  { key: "plate", label: "Placa" },
  { key: "vehicleDamage", label: "Descripción de los daños" },
  { key: "trialDate", label: "Fecha del juicio" },
  { key: "ticketStub", label: "Número o referencia de la colilla" },
  { key: "placeTime", label: "Hora del juicio" },
  { key: "court", label: "Juzgado" }
];

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getMissingCollisionDocumentation(
  item: CollisionDocumentationSource
): CollisionDocumentationRequirement[] {
  return COLLISION_DOCUMENTATION_REQUIREMENTS.filter((requirement) => !hasText(item[requirement.key]));
}

export function collisionDocumentationIsComplete(item: CollisionDocumentationSource): boolean {
  return getMissingCollisionDocumentation(item).length === 0;
}

export function formatMissingCollisionDocumentation(
  item: CollisionDocumentationSource | CollisionDocumentationRequirement[]
): string {
  const missing = Array.isArray(item) ? item : getMissingCollisionDocumentation(item);
  return missing.map((requirement) => requirement.label).join(", ");
}
