export type SellerConsultationDemoEvent = {
  id: string;
  cedula: string;
  sellerName: string;
  consultedAt: string;
  kind: "original" | "follow_up";
};

const storageKey = "rentautos:seller-consultation-local-demo";

function cedulaKey(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export function loadSellerConsultationDemoEvents(): SellerConsultationDemoEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SellerConsultationDemoEvent => Boolean(
      item && typeof item === "object" &&
      typeof (item as SellerConsultationDemoEvent).id === "string" &&
      typeof (item as SellerConsultationDemoEvent).cedula === "string" &&
      typeof (item as SellerConsultationDemoEvent).sellerName === "string" &&
      typeof (item as SellerConsultationDemoEvent).consultedAt === "string" &&
      ((item as SellerConsultationDemoEvent).kind === "original" || (item as SellerConsultationDemoEvent).kind === "follow_up")
    ));
  } catch {
    return [];
  }
}

export function recordSellerConsultationDemo(cedula: string, sellerName: string): {
  event: SellerConsultationDemoEvent;
  originalSellerName: string;
  consultationCount: number;
} {
  const events = loadSellerConsultationDemoEvents();
  const key = cedulaKey(cedula);
  const previous = events.filter((event) => cedulaKey(event.cedula) === key);
  const original = previous.find((event) => event.kind === "original") ?? previous[0];
  const event: SellerConsultationDemoEvent = {
    id: crypto.randomUUID(),
    cedula: cedula.trim().toUpperCase(),
    sellerName: sellerName.trim().replace(/\s+/g, " "),
    consultedAt: new Date().toISOString(),
    kind: original ? "follow_up" : "original"
  };
  const next = [...events, event];
  localStorage.setItem(storageKey, JSON.stringify(next));
  return {
    event,
    originalSellerName: original?.sellerName ?? event.sellerName,
    consultationCount: previous.length + 1
  };
}

export function clearSellerConsultationDemoEvents(): void {
  localStorage.removeItem(storageKey);
}
