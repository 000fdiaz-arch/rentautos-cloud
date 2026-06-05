import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { loadControlUnits } from "../cloudData";
import type { Client, CollisionRecord, CollisionsSettings } from "../types";

type Props = {
  clients: Client[];
  collisions: CollisionRecord[];
  settings: CollisionsSettings;
  canEdit: boolean;
  dataOwnerUserId: string;
  onCollisionsChange: (next: CollisionRecord[]) => Promise<void>;
  onSettingsChange: (next: CollisionsSettings) => Promise<void>;
};

type CollisionDraft = {
  incidentDriverName: string;
  plateSnapshot: string;
  brandModelSnapshot: string;
  collisionDate: string;
  unitId: string;
  colilla: string;
  juzgado: string;
  courtNumber: string;
  hearingAt: string;
  outcome: CollisionRecord["outcome"];
  routeType: NonNullable<CollisionRecord["routeType"]> | "";
  eventLocation: string;
  damageDescription: string;
  resultNotes: string;
  resolutionDate: string;
  resolutionWithdrawalDate: string;
  internalInvoiceNumber: string;
  insurerName: string;
  insurerInvoiceNumber: string;
  insurerInvoiceDate: string;
  insurerInvoiceAmount: string;
  insurerRecoveryStatus: NonNullable<CollisionRecord["insurerRecoveryStatus"]>;
  insurerPaymentDate: string;
  driverName: string;
  driverChargeAmount: string;
  driverChargeStatus: NonNullable<CollisionRecord["driverChargeStatus"]>;
  driverChargePaymentDate: string;
};

function getNowLocalDateTimeValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

const EMPTY_DRAFT: CollisionDraft = {
  incidentDriverName: "",
  plateSnapshot: "",
  brandModelSnapshot: "",
  collisionDate: toDateOnly(new Date().toISOString()),
  unitId: "",
  colilla: "",
  juzgado: "",
  courtNumber: "",
  hearingAt: getNowLocalDateTimeValue(),
  outcome: "pendiente",
  routeType: "",
  eventLocation: "",
  damageDescription: "",
  resultNotes: "",
  resolutionDate: "",
  resolutionWithdrawalDate: "",
  internalInvoiceNumber: "",
  insurerName: "",
  insurerInvoiceNumber: "",
  insurerInvoiceDate: "",
  insurerInvoiceAmount: "",
  insurerRecoveryStatus: "pendiente",
  insurerPaymentDate: "",
  driverName: "",
  driverChargeAmount: "",
  driverChargeStatus: "pendiente",
  driverChargePaymentDate: ""
};

const PANAMA_INSURERS = [
  "Assa compania de seguros",
  "Compania internacional de seguros",
  "Mapfre panama",
  "Aseguradora ancon",
  "Seguros sura panama",
  "Chubb seguros panama",
  "Pan american life insurance de panama",
  "Aseguradora global",
  "Acerta seguros",
  "Aliado seguros",
  "La regional de seguros",
  "Multibank seguros panama"
];
const DEFAULT_COURTS = [
  "San Miguelito",
  "Panama Centro",
  "Panama Oeste",
  "Colon"
];
const DEFAULT_COURT_NUMBERS = ["1", "2", "3", "4", "5", "6"];

function formatCourtLabel(value: string): string {
  return value
    .replace(/^juzgado\s+de\s+transito\s*-\s*/i, "")
    .replace(/^juzgado\s+de\s*/i, "")
    .trim();
}

function normalizeFirstUpperRestLower(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function toDateOnly(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).toISOString().slice(0, 10);
}

function diffDaysFromToday(target: string): number | null {
  if (!target) return null;
  const day = toDateOnly(target);
  if (!day) return null;
  const today = toDateOnly(new Date().toISOString());
  const a = Date.parse(`${today}T00:00:00`);
  const b = Date.parse(`${day}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function toDraft(item: CollisionRecord): CollisionDraft {
  return {
    incidentDriverName: item.incidentDriverName ?? item.driverName ?? "",
    plateSnapshot: item.plateSnapshot ?? "",
    brandModelSnapshot: item.brandModelSnapshot ?? "",
    collisionDate: item.collisionDate,
    unitId: item.unitId,
    colilla: item.colilla,
    juzgado: item.juzgado,
    courtNumber: item.courtNumber ?? "",
    hearingAt: item.hearingAt,
    outcome: item.outcome,
    routeType: item.routeType ?? "",
    eventLocation: item.eventLocation ?? "",
    damageDescription: item.damageDescription ?? "",
    resultNotes: item.resultNotes ?? "",
    resolutionDate: item.resolutionDate ?? "",
    resolutionWithdrawalDate: item.resolutionWithdrawalDate ?? "",
    internalInvoiceNumber: item.internalInvoiceNumber ?? "",
    insurerName: item.insurerName ?? "",
    insurerInvoiceNumber: item.insurerInvoiceNumber ?? "",
    insurerInvoiceDate: item.insurerInvoiceDate ?? "",
    insurerInvoiceAmount: item.insurerInvoiceAmount !== undefined ? String(item.insurerInvoiceAmount) : "",
    insurerRecoveryStatus: item.insurerRecoveryStatus ?? "pendiente",
    insurerPaymentDate: item.insurerPaymentDate ?? "",
    driverName: item.driverName ?? "",
    driverChargeAmount: item.driverChargeAmount !== undefined ? String(item.driverChargeAmount) : "",
    driverChargeStatus: item.driverChargeStatus ?? "pendiente",
    driverChargePaymentDate: item.driverChargePaymentDate ?? ""
  };
}

type ReminderRow = { collisionId: string; label: string; date: string; daysUntil: number };
type CalendarDayCell = { dateIso: string; day: number; inCurrentMonth: boolean };

export default function CollisionsPage({ clients, collisions, settings, canEdit, dataOwnerUserId, onCollisionsChange, onSettingsChange }: Props) {
  const [activeTab, setActiveTab] = useState<"gestion" | "calendario">("calendario");
  const [calendarCursor, setCalendarCursor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CollisionDraft>(EMPTY_DRAFT);
  const [invoiceAttachmentName, setInvoiceAttachmentName] = useState<string>("");
  const [invoiceAttachmentDataUrl, setInvoiceAttachmentDataUrl] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [cedulaAttachmentName, setCedulaAttachmentName] = useState<string>("");
  const [cedulaAttachmentDataUrl, setCedulaAttachmentDataUrl] = useState<string>("");
  const [licenseAttachmentName, setLicenseAttachmentName] = useState<string>("");
  const [licenseAttachmentDataUrl, setLicenseAttachmentDataUrl] = useState<string>("");
  const [damagePhotos, setDamagePhotos] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [courtOptions, setCourtOptions] = useState<string[]>(DEFAULT_COURTS);
  const [courtNumberOptions, setCourtNumberOptions] = useState<string[]>(DEFAULT_COURT_NUMBERS);
  const [insurerOptions, setInsurerOptions] = useState<string[]>(PANAMA_INSURERS);
  const [viaMenuOpen, setViaMenuOpen] = useState<boolean>(false);
  const [viaJuicioSubmenuOpen, setViaJuicioSubmenuOpen] = useState<boolean>(false);
  const [viaAseguradoraSubmenuOpen, setViaAseguradoraSubmenuOpen] = useState<boolean>(false);
  const [viaCourtNumberSubmenuOpen, setViaCourtNumberSubmenuOpen] = useState<boolean>(false);
  const [viaCourtNumberParent, setViaCourtNumberParent] = useState<string | null>(null);
  const [plateByUnit, setPlateByUnit] = useState<Record<string, string>>({});
  const [brandModelByUnit, setBrandModelByUnit] = useState<Record<string, string>>({});
  const hearingDatePart = draft.hearingAt.includes("T") ? draft.hearingAt.slice(0, 10) : "";
  const hearingTimePart = draft.hearingAt.includes("T") ? draft.hearingAt.slice(11, 16) : "";

  useEffect(() => {
    const normalized = Array.from(
      new Set([...DEFAULT_COURTS, ...(settings.courtOptions ?? [])].map((item) => String(item ?? "").trim()).filter((item) => item.length > 0))
    );
    setCourtOptions(normalized);
  }, [settings.courtOptions]);

  useEffect(() => {
    setCourtNumberOptions(DEFAULT_COURT_NUMBERS);
  }, []);

  useEffect(() => {
    const normalized = Array.from(
      new Set([...PANAMA_INSURERS, ...(settings.insurerOptions ?? [])].map((item) => String(item ?? "").trim()).filter((item) => item.length > 0))
    );
    setInsurerOptions(normalized);
  }, [settings.insurerOptions]);

  const sortedUnits = useMemo(
    () => Array.from(new Set(clients.map((item) => item.unitId.trim().toUpperCase()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [clients]
  );
  const clientNameByUnit = useMemo(
    () =>
      new Map(
        clients.map((item) => [item.unitId.trim().toUpperCase(), item.name.trim()])
      ),
    [clients]
  );
  const currentSuggestedDriver = useMemo(() => {
    const unit = draft.unitId.trim().toUpperCase();
    return clientNameByUnit.get(unit) ?? "";
  }, [clientNameByUnit, draft.unitId]);

  const driverSuggestions = useMemo(() => {
    const unit = draft.unitId.trim().toUpperCase();
    const suggested = clientNameByUnit.get(unit);
    const recentByUnit = collisions
      .filter((item) => item.unitId.trim().toUpperCase() === unit)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => (item.incidentDriverName ?? "").trim())
      .filter((name) => name.length > 0);
    const uniq = new Set<string>();
    const list: string[] = [];
    if (suggested && suggested.trim().length > 0) {
      uniq.add(suggested.trim());
      list.push(suggested.trim());
    }
    for (const name of recentByUnit) {
      if (uniq.has(name)) continue;
      uniq.add(name);
      list.push(name);
      if (list.length >= 4) break;
    }
    return list;
  }, [clientNameByUnit, collisions, draft.unitId]);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      if (!dataOwnerUserId) return;
      try {
        const rows = await loadControlUnits(dataOwnerUserId);
        if (cancelled) return;
        const next: Record<string, string> = {};
        const nextBrandModel: Record<string, string> = {};
        for (const row of rows) {
          const unit = String(row.unit_id ?? "").trim().toUpperCase();
          if (!unit) continue;
          const plate = String(row.plate ?? "").trim().toUpperCase();
          const brandModel = String(row.brand_model ?? "").trim();
          next[unit] = plate;
          nextBrandModel[unit] = brandModel;
        }
        setPlateByUnit(next);
        setBrandModelByUnit(nextBrandModel);
      } catch {
        if (!cancelled) {
          setPlateByUnit({});
          setBrandModelByUnit({});
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

  const reminders = useMemo(() => {
    const rows: ReminderRow[] = [];
    for (const item of collisions) {
      const candidates: Array<{ label: string; date: string }> = [
        { label: `Juicio (${item.unitId})`, date: item.hearingAt },
        { label: `Resolucion (${item.unitId})`, date: item.resolutionDate ?? "" },
        { label: `Retiro de resolucion (${item.unitId})`, date: item.resolutionWithdrawalDate ?? "" }
      ];
      if (item.outcome === "ganado" && item.insurerRecoveryStatus !== "pagado" && item.insurerInvoiceDate) {
        candidates.push({ label: `Seguimiento aseguradora (${item.unitId})`, date: item.insurerInvoiceDate });
      }
      if (item.outcome === "perdido" && item.driverChargeStatus !== "cobrado" && item.resolutionDate) {
        candidates.push({ label: `Cobro al conductor (${item.unitId})`, date: item.resolutionDate });
      }
      for (const candidate of candidates) {
        const daysUntil = diffDaysFromToday(candidate.date);
        if (daysUntil === null) continue;
        rows.push({ collisionId: item.id, label: candidate.label, date: candidate.date, daysUntil });
      }
    }
    return rows.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [collisions]);

  const reminderEventsByDate = useMemo(() => {
    const map = new Map<string, ReminderRow[]>();
    for (const row of reminders) {
      const day = toDateOnly(row.date);
      if (!day) continue;
      const current = map.get(day) ?? [];
      current.push(row);
      map.set(day, current);
    }
    return map;
  }, [reminders]);

  const calendarRows = useMemo(
    () =>
      [...collisions]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((item) => ({
          id: item.id,
          collisionDate: item.collisionDate,
          unitId: item.unitId,
          brandModelSnapshot: item.brandModelSnapshot ?? "-",
          colilla: item.colilla,
          juzgado: item.juzgado,
          courtNumber: item.courtNumber ?? "-",
          hearingAt: item.hearingAt,
          hearingDate: item.hearingAt ? item.hearingAt.slice(0, 10) : "-",
          hearingTime: item.hearingAt ? item.hearingAt.slice(11, 16) : "-",
          outcome: item.outcome ?? "-",
          resultNotes: item.resultNotes ?? "-",
          resolutionDate: item.resolutionDate ?? "-",
          resolutionWithdrawalDate: item.resolutionWithdrawalDate ?? "-",
          internalInvoiceNumber: item.internalInvoiceNumber ?? "-",
          internalInvoiceAttachmentName: item.internalInvoiceAttachmentName ?? "-",
          insurerName: item.insurerName ?? "-",
          eventLocation: item.eventLocation ?? "-",
          damageDescription: item.damageDescription ?? "-",
          insurerInvoiceNumber: item.insurerInvoiceNumber ?? "-",
          insurerInvoiceDate: item.insurerInvoiceDate ?? "-",
          insurerInvoiceAmount: item.insurerInvoiceAmount !== undefined ? String(item.insurerInvoiceAmount) : "-",
          insurerRecoveryStatus: item.insurerRecoveryStatus ?? "-",
          insurerPaymentDate: item.insurerPaymentDate ?? "-",
          driverChargeAmount: item.driverChargeAmount !== undefined ? String(item.driverChargeAmount) : "-",
          driverChargeStatus: item.driverChargeStatus ?? "-",
          driverChargePaymentDate: item.driverChargePaymentDate ?? "-",
          cedulaAttachmentName: item.cedulaAttachmentName ?? "-",
          licenseAttachmentName: item.licenseAttachmentName ?? "-",
          damagePhotosCount: item.damagePhotos?.length ?? 0,
          routeType: item.routeType === "reclamo_aseguradora" ? "Aseguradora" : "Juicio",
          incidentDriverName: item.incidentDriverName ?? "-",
          plateSnapshot: item.plateSnapshot ?? "-"
        })),
    [collisions]
  );
  const agendaJuicioRows = useMemo(
    () => calendarRows.filter((row) => row.routeType === "Juicio"),
    [calendarRows]
  );
  const agendaAseguradoraRows = useMemo(
    () => calendarRows.filter((row) => row.routeType === "Aseguradora"),
    [calendarRows]
  );

  const monthLabel = useMemo(
    () => calendarCursor.toLocaleDateString("es-PA", { month: "long", year: "numeric" }),
    [calendarCursor]
  );

  const calendarMatrix = useMemo(() => {
    const start = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const startWeekday = (start.getDay() + 6) % 7; // monday-first
    const firstCell = new Date(start);
    firstCell.setDate(firstCell.getDate() - startWeekday);
    const cells: CalendarDayCell[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(firstCell);
      d.setDate(firstCell.getDate() + i);
      cells.push({
        dateIso: toDateOnly(d.toISOString()),
        day: d.getDate(),
        inCurrentMonth: d.getMonth() === calendarCursor.getMonth() && d.getFullYear() === calendarCursor.getFullYear()
      });
    }
    const weeks: CalendarDayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [calendarCursor]);

  async function onAttachInvoiceFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });
    setInvoiceAttachmentName(file.name);
    setInvoiceAttachmentDataUrl(dataUrl);
  }

  function resetForm(): void {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setInvoiceAttachmentName("");
    setInvoiceAttachmentDataUrl("");
    setErrorMessage("");
    setCedulaAttachmentName("");
    setCedulaAttachmentDataUrl("");
    setLicenseAttachmentName("");
    setLicenseAttachmentDataUrl("");
    setDamagePhotos([]);
  }

  function persistCourtOptions(next: string[]): void {
    setCourtOptions(next);
    void onSettingsChange({
      ...settings,
      courtOptions: next
    });
  }

  function persistCourtNumberOptions(next: string[]): void {
    setCourtNumberOptions(next);
  }

  function persistInsurerOptions(next: string[]): void {
    setInsurerOptions(next);
    void onSettingsChange({
      ...settings,
      insurerOptions: next
    });
  }

  function addCourtOptionValue(rawName: string): string | null {
    const nextName = rawName.trim();
    if (!nextName) return;
    const exists = courtOptions.some((item) => item.toLowerCase() === nextName.toLowerCase());
    if (exists) {
      return courtOptions.find((item) => item.toLowerCase() === nextName.toLowerCase()) ?? null;
    }
    const next = [...courtOptions, nextName].sort((a, b) => a.localeCompare(b));
    persistCourtOptions(next);
    return nextName;
  }

  function addCourtNumberOptionValue(rawName: string): string | null {
    const nextName = rawName.trim();
    if (!nextName) return null;
    const exists = courtNumberOptions.some((item) => item.toLowerCase() === nextName.toLowerCase());
    if (exists) {
      return courtNumberOptions.find((item) => item.toLowerCase() === nextName.toLowerCase()) ?? null;
    }
    const next = [...courtNumberOptions, nextName].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    persistCourtNumberOptions(next);
    return nextName;
  }

  function addInsurerOptionValue(rawName: string): string | null {
    const nextName = rawName.trim();
    if (!nextName) return null;
    const exists = insurerOptions.some((item) => item.toLowerCase() === nextName.toLowerCase());
    if (exists) {
      return insurerOptions.find((item) => item.toLowerCase() === nextName.toLowerCase()) ?? null;
    }
    const next = [...insurerOptions, nextName].sort((a, b) => a.localeCompare(b));
    persistInsurerOptions(next);
    return nextName;
  }

  function updateHearingDate(nextDate: string): void {
    setDraft((prev) => {
      const currentTime = prev.hearingAt.includes("T") ? prev.hearingAt.slice(11, 16) : "09:00";
      return { ...prev, hearingAt: nextDate ? `${nextDate}T${currentTime}` : "" };
    });
  }

  function updateHearingTime(nextTime: string): void {
    setDraft((prev) => {
      const currentDate = prev.hearingAt.includes("T") ? prev.hearingAt.slice(0, 10) : toDateOnly(new Date().toISOString());
      return nextTime ? { ...prev, hearingAt: `${currentDate}T${nextTime}` } : { ...prev, hearingAt: "" };
    });
  }

  function startEdit(item: CollisionRecord): void {
    setEditingId(item.id);
    setDraft(toDraft(item));
    setInvoiceAttachmentName(item.internalInvoiceAttachmentName ?? "");
    setInvoiceAttachmentDataUrl(item.internalInvoiceAttachmentDataUrl ?? "");
    setCedulaAttachmentName(item.cedulaAttachmentName ?? "");
    setCedulaAttachmentDataUrl(item.cedulaAttachmentDataUrl ?? "");
    setLicenseAttachmentName(item.licenseAttachmentName ?? "");
    setLicenseAttachmentDataUrl(item.licenseAttachmentDataUrl ?? "");
    setDamagePhotos(Array.isArray(item.damagePhotos) ? item.damagePhotos.slice(0, 20) : []);
    setErrorMessage("");
  }

  async function attachSingleFile(
    event: ChangeEvent<HTMLInputElement>,
    onDone: (payload: { name: string; dataUrl: string }) => void
  ): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });
    onDone({ name: file.name, dataUrl });
  }

  async function attachDamagePhotos(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const available = Math.max(0, 20 - damagePhotos.length);
    const toLoad = files.slice(0, available);
    const loaded = await Promise.all(toLoad.map((file) => new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result ?? "") });
      reader.onerror = () => reject(new Error("No se pudo leer foto"));
      reader.readAsDataURL(file);
    })));
    setDamagePhotos((prev) => [...prev, ...loaded].slice(0, 20));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canEdit) return;
    if (!draft.collisionDate || !draft.unitId) {
      setErrorMessage("Completa los campos obligatorios: fecha y unidad.");
      return;
    }
    if (!draft.routeType) {
      setErrorMessage("Selecciona la VIA.");
      return;
    }
    if (draft.routeType === "juicio") {
      if (!hearingDatePart || !hearingTimePart || !draft.juzgado.trim() || !draft.colilla.trim()) {
        setErrorMessage("Para VIA Juicio debes completar: fecha, hora, juzgado y colilla.");
        return;
      }
    }
    if (draft.routeType === "reclamo_aseguradora") {
      if (!draft.eventLocation.trim() || !draft.insurerName.trim() || !draft.damageDescription.trim() || !draft.insurerInvoiceAmount.trim()) {
        setErrorMessage("Para VIA Aseguradora debes completar: lugar del evento, aseguradora, descripcion de danos y monto.");
        return;
      }
      if (!Number.isFinite(Number(draft.insurerInvoiceAmount)) || Number(draft.insurerInvoiceAmount) < 0) {
        setErrorMessage("El monto de aseguradora debe ser un numero valido.");
        return;
      }
    }
    const now = new Date().toISOString();
    const insurerName = normalizeFirstUpperRestLower(draft.insurerName);
    const nextItem: CollisionRecord = {
      id: editingId ?? crypto.randomUUID(),
      createdAt: collisions.find((item) => item.id === editingId)?.createdAt ?? now,
      updatedAt: now,
      incidentDriverName: draft.incidentDriverName.trim() || undefined,
      plateSnapshot: draft.plateSnapshot.trim().toUpperCase() || undefined,
      brandModelSnapshot: draft.brandModelSnapshot.trim() || undefined,
      collisionDate: draft.collisionDate,
      unitId: draft.unitId.trim().toUpperCase(),
      colilla: draft.colilla.trim() || "N/A",
      juzgado: draft.juzgado.trim() || "N/A",
      courtNumber: draft.courtNumber.trim() || undefined,
      hearingAt: draft.hearingAt || `${draft.collisionDate}T09:00`,
      outcome: draft.outcome,
      routeType: draft.routeType,
      eventLocation: draft.eventLocation.trim() || undefined,
      damageDescription: draft.damageDescription.trim() || undefined,
      resultNotes: draft.resultNotes.trim() || undefined,
      resolutionDate: draft.resolutionDate || undefined,
      resolutionWithdrawalDate: draft.resolutionWithdrawalDate || undefined,
      internalInvoiceNumber: draft.internalInvoiceNumber.trim() || undefined,
      internalInvoiceAttachmentName: invoiceAttachmentName || undefined,
      internalInvoiceAttachmentDataUrl: invoiceAttachmentDataUrl || undefined,
      cedulaAttachmentName: cedulaAttachmentName || undefined,
      cedulaAttachmentDataUrl: cedulaAttachmentDataUrl || undefined,
      licenseAttachmentName: licenseAttachmentName || undefined,
      licenseAttachmentDataUrl: licenseAttachmentDataUrl || undefined,
      damagePhotos: damagePhotos.length > 0 ? damagePhotos : undefined,
      insurerName: insurerName || undefined,
      insurerInvoiceNumber: draft.insurerInvoiceNumber.trim() || undefined,
      insurerInvoiceDate: draft.insurerInvoiceDate || undefined,
      insurerInvoiceAmount: Number.isFinite(Number(draft.insurerInvoiceAmount)) ? Number(draft.insurerInvoiceAmount) : undefined,
      insurerRecoveryStatus: draft.outcome === "ganado" ? draft.insurerRecoveryStatus : undefined,
      insurerPaymentDate: draft.insurerPaymentDate || undefined,
      driverName: draft.driverName.trim() || undefined,
      driverChargeAmount: Number.isFinite(Number(draft.driverChargeAmount)) ? Number(draft.driverChargeAmount) : undefined,
      driverChargeStatus: draft.outcome === "perdido" ? draft.driverChargeStatus : undefined,
      driverChargePaymentDate: draft.driverChargePaymentDate || undefined
    };
    const next = editingId
      ? collisions.map((item) => item.id === editingId ? nextItem : item)
      : [nextItem, ...collisions];
    await onCollisionsChange(next);
    resetForm();
    setActiveTab("calendario");
  }

  async function handleDelete(id: string): Promise<void> {
    if (!canEdit) return;
    const next = collisions.filter((item) => item.id !== id);
    await onCollisionsChange(next);
    if (editingId === id) resetForm();
  }

  async function handleSettingsChange(patch: Partial<CollisionsSettings>): Promise<void> {
    if (!canEdit) return;
    await onSettingsChange({ ...settings, ...patch });
  }

  return (
    <>
      <section className="panel siniestros-luxury-tabs">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`button ghost small ${activeTab === "gestion" ? "cash-tab-active" : ""}`}
            onClick={() => setActiveTab("gestion")}
          >
            Registro
          </button>
          <button
            type="button"
            className={`button ghost small ${activeTab === "calendario" ? "cash-tab-active" : ""}`}
            onClick={() => setActiveTab("calendario")}
          >
            Agenda
          </button>
        </div>
      </section>

      {activeTab === "gestion" && (
      <section className="panel siniestros-luxury-panel siniestros-registro-premium">
        <div className="panel-head">
        </div>
        {!canEdit && <p className="hint">Modo solo lectura: solo el encargado puede editar este modulo.</p>}
        {canEdit && (
          <form className="form-grid siniestros-luxury-form siniestros-executive-grid" onSubmit={(event) => void handleSubmit(event)}>
            <div className="siniestros-summary-strip" style={{ gridColumn: "1 / -1" }}>
              <div className="siniestros-summary-item">
                <span>Unidad</span>
                <strong>{draft.unitId || "Sin unidad"}</strong>
              </div>
              <div className="siniestros-summary-item">
                <span>Placa</span>
                <strong>{draft.plateSnapshot || "Pendiente"}</strong>
              </div>
              <div className="siniestros-summary-item">
                <span>Modelo y marca</span>
                <strong>{draft.brandModelSnapshot || "Pendiente"}</strong>
              </div>
              <div className="siniestros-summary-item">
                <span>VIA</span>
                <strong>
                  {!draft.routeType ? "Sin definir" : draft.routeType === "juicio" ? "Juicio" : draft.insurerName ? `Aseguradora - ${draft.insurerName}` : "Aseguradora"}
                </strong>
              </div>
            </div>

            <section className="siniestros-form-block siniestros-form-block--base" style={{ gridColumn: "1 / -1" }}>
              <div className="siniestros-form-block-head">
                <h3>Datos base</h3>
                <p>Captura inicial del caso para identificar la unidad y el conductor.</p>
              </div>
              <div className="siniestros-form-block-grid">
                <label>Fecha del siniestro*
                  <input type="date" value={draft.collisionDate} onChange={(e) => setDraft((prev) => ({ ...prev, collisionDate: e.target.value }))} />
                </label>
                <label>Unidad*
                  <input
                    list="collision-units"
                    value={draft.unitId}
                    onChange={(e) =>
                      setDraft((prev) => {
                        const nextUnitId = e.target.value.toUpperCase();
                        const autoDriverName = clientNameByUnit.get(nextUnitId) ?? "";
                        const autoPlate = plateByUnit[nextUnitId] ?? "";
                        const autoBrandModel = brandModelByUnit[nextUnitId] ?? "";
                        return {
                          ...prev,
                          unitId: nextUnitId,
                          incidentDriverName: autoDriverName,
                          plateSnapshot: autoPlate,
                          brandModelSnapshot: autoBrandModel
                        };
                      })
                    }
                  />
                </label>
                <label>Conductor
                  <input
                    list="collision-driver-suggestions"
                    value={draft.incidentDriverName}
                    onChange={(e) => setDraft((prev) => ({ ...prev, incidentDriverName: e.target.value }))}
                    placeholder="Nombre al momento del incidente"
                  />
                  {currentSuggestedDriver.trim().length > 0 &&
                    draft.incidentDriverName.trim() !== currentSuggestedDriver.trim() && (
                      <button
                        type="button"
                        className="button ghost small"
                        style={{ marginTop: 6 }}
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, incidentDriverName: currentSuggestedDriver }))
                        }
                      >
                        Restaurar sugerido
                      </button>
                    )}
                </label>
                <div className="siniestros-info-card">
                  <span>Placa</span>
                  <strong>{draft.plateSnapshot || "Pendiente"}</strong>
                </div>
                <div className="siniestros-info-card">
                  <span>Modelo y marca</span>
                  <strong>{draft.brandModelSnapshot || "Pendiente"}</strong>
                </div>
              </div>
            </section>

            <section className="siniestros-form-block siniestros-form-block--via" style={{ gridColumn: "1 / -1" }}>
              <div className="siniestros-form-block-head">
                <h3>Via de gestion</h3>
                <p>Selecciona si el caso se gestionara por juicio o por aseguradora.</p>
              </div>
              <div className="siniestros-form-block-grid">
                <label style={{ gridColumn: "1 / -1", position: "relative", zIndex: 80 }}>VIA
                  <div
                    style={{ position: "relative", display: "inline-block", zIndex: 90 }}
                    onMouseLeave={() => {
                      setViaJuicioSubmenuOpen(false);
                      setViaAseguradoraSubmenuOpen(false);
                      setViaCourtNumberSubmenuOpen(false);
                      setViaCourtNumberParent(null);
                      setViaMenuOpen(false);
                    }}
                  >
                    <button
                      type="button"
                      className="button ghost small siniestros-via-trigger"
                      onClick={() => setViaMenuOpen((prev) => !prev)}
                      style={{ minWidth: 320, textAlign: "left" }}
                    >
                      {!draft.routeType
                        ? "Selecciona VIA"
                        : draft.routeType === "juicio"
                        ? `Juicio - ${draft.juzgado ? formatCourtLabel(draft.juzgado) : "Elegir juzgado"}${draft.courtNumber ? ` - ${draft.courtNumber}` : ""}`
                        : `Aseguradora${draft.insurerName ? ` > ${draft.insurerName}` : ""}`}
                    </button>

                    {viaMenuOpen && (
                      <div style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        zIndex: 1000,
                        background: "#f5f3f7",
                        border: "1px solid #d6d3dd",
                        borderRadius: 12,
                        minWidth: 240,
                        boxShadow: "0 14px 30px rgba(15, 23, 42, 0.18)",
                        padding: 6
                      }}>
                        <div
                          style={{ position: "relative" }}
                          onMouseEnter={() => {
                            setViaJuicioSubmenuOpen(true);
                            setViaAseguradoraSubmenuOpen(false);
                            setViaCourtNumberSubmenuOpen(false);
                            setViaCourtNumberParent(null);
                          }}
                        >
                          <div style={{ padding: "9px 12px", borderRadius: 8, cursor: "default", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ letterSpacing: 0.4 }}>JUICIO</span>
                            <span style={{ opacity: 0.6 }}>{">"}</span>
                          </div>
                          {viaJuicioSubmenuOpen && (
                            <div style={{
                              position: "absolute",
                              top: -6,
                              left: "100%",
                              marginLeft: 8,
                              zIndex: 1100,
                              background: "#f5f3f7",
                              border: "1px solid #d6d3dd",
                              borderRadius: 12,
                              minWidth: 360,
                              boxShadow: "0 14px 30px rgba(15, 23, 42, 0.18)",
                              padding: 6,
                              overflow: "visible"
                            }}>
                              {courtOptions.map((court) => (
                                <div
                                  key={court}
                                  style={{ position: "relative" }}
                                  onMouseEnter={() => {
                                    const isJuanDiaz = formatCourtLabel(court).toLowerCase() === "juan diaz";
                                    if (isJuanDiaz) {
                                      setViaCourtNumberSubmenuOpen(true);
                                      setViaCourtNumberParent(court);
                                    } else {
                                      setViaCourtNumberSubmenuOpen(false);
                                      setViaCourtNumberParent(null);
                                    }
                                  }}
                                >
                                  <button
                                    type="button"
                                    style={{ width: "100%", textAlign: "left", padding: "9px 12px", background: "transparent", border: "none", borderRadius: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                    onClick={() => {
                                      const isJuanDiaz = formatCourtLabel(court).toLowerCase() === "juan diaz";
                                      setDraft((prev) => ({ ...prev, routeType: "juicio", insurerName: "", juzgado: court, courtNumber: "" }));
                                      if (isJuanDiaz) {
                                        setViaCourtNumberSubmenuOpen(true);
                                        setViaCourtNumberParent(court);
                                      } else {
                                        setViaMenuOpen(false);
                                        setViaJuicioSubmenuOpen(false);
                                        setViaAseguradoraSubmenuOpen(false);
                                        setViaCourtNumberSubmenuOpen(false);
                                        setViaCourtNumberParent(null);
                                      }
                                    }}
                                  >
                                    <span>{formatCourtLabel(court)}</span>
                                    {formatCourtLabel(court).toLowerCase() === "juan diaz" ? <span style={{ opacity: 0.6 }}>{">"}</span> : null}
                                  </button>
                                  {formatCourtLabel(court).toLowerCase() === "juan diaz" &&
                                    viaCourtNumberSubmenuOpen &&
                                    viaCourtNumberParent === court ? (
                                    <div style={{
                                      position: "absolute",
                                      top: -6,
                                      left: "100%",
                                      marginLeft: 8,
                                      zIndex: 1200,
                                      background: "#f5f3f7",
                                      border: "1px solid #d6d3dd",
                                      borderRadius: 12,
                                      minWidth: 180,
                                      boxShadow: "0 14px 30px rgba(15, 23, 42, 0.18)",
                                      padding: 6,
                                      overflow: "visible"
                                    }}>
                                      {courtNumberOptions.map((courtNumber) => (
                                        <button
                                          key={`juandiaz-${courtNumber}`}
                                          type="button"
                                          style={{ width: "100%", textAlign: "left", padding: "9px 12px", background: "transparent", border: "none", borderRadius: 8, cursor: "pointer" }}
                                          onClick={() => {
                                            setDraft((prev) => ({ ...prev, routeType: "juicio", insurerName: "", juzgado: court, courtNumber }));
                                            setViaMenuOpen(false);
                                            setViaJuicioSubmenuOpen(false);
                                            setViaAseguradoraSubmenuOpen(false);
                                            setViaCourtNumberSubmenuOpen(false);
                                            setViaCourtNumberParent(null);
                                          }}
                                        >
                                          {courtNumber}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                              <div style={{ borderTop: "1px solid #d6d3dd", margin: "6px 0" }} />
                              <button
                                type="button"
                                style={{ width: "100%", textAlign: "left", padding: "9px 12px", background: "transparent", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}
                                onClick={() => {
                                  const value = window.prompt("Nuevo juzgado:");
                                  if (!value) return;
                                  const created = addCourtOptionValue(value);
                                  if (!created) return;
                                  setDraft((prev) => ({ ...prev, routeType: "juicio", insurerName: "", juzgado: created, courtNumber: "" }));
                                  setViaMenuOpen(false);
                                  setViaJuicioSubmenuOpen(false);
                                  setViaAseguradoraSubmenuOpen(false);
                                  setViaCourtNumberSubmenuOpen(false);
                                  setViaCourtNumberParent(null);
                                }}
                              >
                                + Agregar otro...
                              </button>
                            </div>
                          )}
                        </div>
                        <div
                          style={{ position: "relative" }}
                          onMouseEnter={() => {
                            setViaAseguradoraSubmenuOpen(true);
                            setViaJuicioSubmenuOpen(false);
                            setViaCourtNumberSubmenuOpen(false);
                            setViaCourtNumberParent(null);
                          }}
                        >
                          <div style={{ padding: "9px 12px", borderRadius: 8, cursor: "default", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ letterSpacing: 0.4 }}>ASEGURADORA</span>
                            <span style={{ opacity: 0.6 }}>{">"}</span>
                          </div>
                          {viaAseguradoraSubmenuOpen && (
                            <div style={{
                              position: "absolute",
                              top: -6,
                              left: "100%",
                              marginLeft: 8,
                              zIndex: 1100,
                              background: "#f5f3f7",
                              border: "1px solid #d6d3dd",
                              borderRadius: 12,
                              minWidth: 280,
                              boxShadow: "0 14px 30px rgba(15, 23, 42, 0.18)",
                              padding: 6,
                              maxHeight: 260,
                              overflowY: "auto"
                            }}>
                              {insurerOptions.map((name) => (
                                <button
                                  key={name}
                                  type="button"
                                  style={{ width: "100%", textAlign: "left", padding: "9px 12px", background: "transparent", border: "none", borderRadius: 8, cursor: "pointer" }}
                                  onClick={() => {
                                    setDraft((prev) => ({ ...prev, routeType: "reclamo_aseguradora", insurerName: name, courtNumber: "", juzgado: "" }));
                                    setViaMenuOpen(false);
                                    setViaAseguradoraSubmenuOpen(false);
                                    setViaJuicioSubmenuOpen(false);
                                    setViaCourtNumberSubmenuOpen(false);
                                    setViaCourtNumberParent(null);
                                  }}
                                >
                                  {name}
                                </button>
                              ))}
                              <div style={{ borderTop: "1px solid #d6d3dd", margin: "6px 0" }} />
                              <button
                                type="button"
                                style={{ width: "100%", textAlign: "left", padding: "9px 12px", background: "transparent", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}
                                onClick={() => {
                                  const value = window.prompt("Nueva aseguradora:");
                                  if (!value) return;
                                  const created = addInsurerOptionValue(value);
                                  if (!created) return;
                                  setDraft((prev) => ({ ...prev, routeType: "reclamo_aseguradora", insurerName: created, courtNumber: "", juzgado: "" }));
                                  setViaMenuOpen(false);
                                  setViaAseguradoraSubmenuOpen(false);
                                  setViaJuicioSubmenuOpen(false);
                                  setViaCourtNumberSubmenuOpen(false);
                                  setViaCourtNumberParent(null);
                                }}
                              >
                                + Agregar otro...
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </section>

            <section className="siniestros-form-block siniestros-form-block--detail" style={{ gridColumn: "1 / -1" }}>
              <div className="siniestros-form-block-head">
                <h3>Detalle del caso</h3>
                <p>Completa aqui la informacion operativa segun la via seleccionada.</p>
              </div>
              <div className="siniestros-form-block-grid">
                {draft.routeType === "juicio" && (
                  <>
                    <label>Fecha del juicio
                      <input type="date" value={hearingDatePart} onChange={(e) => updateHearingDate(e.target.value)} />
                    </label>
                    <label>Hora del juicio
                      <input type="time" value={hearingTimePart} onChange={(e) => updateHearingTime(e.target.value)} />
                    </label>
                    <label>Juzgado
                      <select value={draft.juzgado} onChange={(e) => setDraft((prev) => ({ ...prev, juzgado: e.target.value }))}>
                        <option value="">Selecciona juzgado</option>
                        {courtOptions.map((court) => (
                          <option key={court} value={court}>{formatCourtLabel(court)}</option>
                        ))}
                      </select>
                    </label>
                    <label>Colilla
                      <input value={draft.colilla} onChange={(e) => setDraft((prev) => ({ ...prev, colilla: e.target.value }))} />
                    </label>
                  </>
                )}

                {draft.routeType === "reclamo_aseguradora" && (
                  <>
                    <label>Lugar del evento
                      <input value={draft.eventLocation} onChange={(e) => setDraft((prev) => ({ ...prev, eventLocation: e.target.value }))} />
                    </label>
                    <label>Aseguradora
                      <input value={draft.insurerName} readOnly placeholder="Seleccionada desde VIA" />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>Descripcion de los danos
                      <textarea
                        value={draft.damageDescription}
                        onChange={(e) => setDraft((prev) => ({ ...prev, damageDescription: e.target.value }))}
                        rows={6}
                        style={{ width: "100%", resize: "vertical", minHeight: 140 }}
                        placeholder="Detalla completamente los danos observados..."
                      />
                    </label>
                    <label>Monto
                      <input type="number" min="0" step="0.01" value={draft.insurerInvoiceAmount} onChange={(e) => setDraft((prev) => ({ ...prev, insurerInvoiceAmount: e.target.value }))} />
                    </label>
                  </>
                )}

                {!draft.routeType && (
                  <div className="siniestros-empty-state">
                    <strong>Selecciona la VIA para continuar</strong>
                    <span>El formulario mostrara automaticamente los campos de juicio o aseguradora.</span>
                  </div>
                )}
              </div>
            </section>

            <section className="siniestros-form-block siniestros-form-block--result" style={{ gridColumn: "1 / -1" }}>
              <div className="siniestros-form-block-head">
                <h3>Resultado y seguimiento</h3>
                <p>Registra el estado del caso, notas internas y cualquier seguimiento posterior.</p>
              </div>
              <div className="siniestros-form-block-grid">
                <label>Resultado
                  <select value={draft.outcome} onChange={(e) => setDraft((prev) => ({ ...prev, outcome: e.target.value as CollisionRecord["outcome"] }))}>
                    <option value="pendiente">Pendiente</option>
                    <option value="ganado">Ganado</option>
                    <option value="perdido">Perdido</option>
                  </select>
                </label>
                <label>Factura interna
                  <input value={draft.internalInvoiceNumber} onChange={(e) => setDraft((prev) => ({ ...prev, internalInvoiceNumber: e.target.value }))} />
                </label>
                <label>Fecha de resolucion
                  <input type="date" value={draft.resolutionDate} onChange={(e) => setDraft((prev) => ({ ...prev, resolutionDate: e.target.value }))} />
                </label>
                <label>Fecha de retiro de resolucion
                  <input type="date" value={draft.resolutionWithdrawalDate} onChange={(e) => setDraft((prev) => ({ ...prev, resolutionWithdrawalDate: e.target.value }))} />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>Notas
                  <textarea value={draft.resultNotes} onChange={(e) => setDraft((prev) => ({ ...prev, resultNotes: e.target.value }))} rows={4} placeholder="Resumen ejecutivo, acuerdos, observaciones o proximo paso." />
                </label>

                {draft.outcome === "ganado" && (
                  <>
                    <label>Factura a aseguradora
                      <input value={draft.insurerInvoiceNumber} onChange={(e) => setDraft((prev) => ({ ...prev, insurerInvoiceNumber: e.target.value }))} />
                    </label>
                    <label>Fecha factura aseguradora
                      <input type="date" value={draft.insurerInvoiceDate} onChange={(e) => setDraft((prev) => ({ ...prev, insurerInvoiceDate: e.target.value }))} />
                    </label>
                    <label>Monto factura aseguradora
                      <input type="number" min="0" step="0.01" value={draft.insurerInvoiceAmount} onChange={(e) => setDraft((prev) => ({ ...prev, insurerInvoiceAmount: e.target.value }))} />
                    </label>
                    <label>Seguimiento de cobro
                      <select value={draft.insurerRecoveryStatus} onChange={(e) => setDraft((prev) => ({ ...prev, insurerRecoveryStatus: e.target.value as NonNullable<CollisionRecord["insurerRecoveryStatus"]> }))}>
                        <option value="pendiente">Pendiente</option>
                        <option value="facturado">Facturado</option>
                        <option value="pagado">Pagado</option>
                      </select>
                    </label>
                    <label>Fecha de pago aseguradora
                      <input type="date" value={draft.insurerPaymentDate} onChange={(e) => setDraft((prev) => ({ ...prev, insurerPaymentDate: e.target.value }))} />
                    </label>
                  </>
                )}

                {draft.outcome === "perdido" && (
                  <>
                    <label>Conductor
                      <input value={draft.driverName} onChange={(e) => setDraft((prev) => ({ ...prev, driverName: e.target.value }))} />
                    </label>
                    <label>Monto a cobrar al conductor
                      <input type="number" min="0" step="0.01" value={draft.driverChargeAmount} onChange={(e) => setDraft((prev) => ({ ...prev, driverChargeAmount: e.target.value }))} />
                    </label>
                    <label>Estado de cobro conductor
                      <select value={draft.driverChargeStatus} onChange={(e) => setDraft((prev) => ({ ...prev, driverChargeStatus: e.target.value as NonNullable<CollisionRecord["driverChargeStatus"]> }))}>
                        <option value="pendiente">Pendiente</option>
                        <option value="cobrado">Cobrado</option>
                      </select>
                    </label>
                    <label>Fecha de cobro conductor
                      <input type="date" value={draft.driverChargePaymentDate} onChange={(e) => setDraft((prev) => ({ ...prev, driverChargePaymentDate: e.target.value }))} />
                    </label>
                  </>
                )}
              </div>
            </section>

            <section className="siniestros-form-block siniestros-form-block--uploads" style={{ gridColumn: "1 / -1" }}>
              <div className="siniestros-form-block-head">
                <h3>Adjuntos</h3>
                <p>Centraliza aqui la documentacion y evidencia del caso.</p>
              </div>
              <div className="siniestros-upload-grid">
                <label className="siniestros-upload-card">Factura interna
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => void onAttachInvoiceFile(e)} />
                  <small>{invoiceAttachmentName || "Pendiente de adjuntar"}</small>
                </label>
                <label className="siniestros-upload-card">Cedula
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => void attachSingleFile(e, (payload) => {
                    setCedulaAttachmentName(payload.name);
                    setCedulaAttachmentDataUrl(payload.dataUrl);
                  })} />
                  <small>{cedulaAttachmentName || "Pendiente de adjuntar"}</small>
                </label>
                <label className="siniestros-upload-card">Licencia
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => void attachSingleFile(e, (payload) => {
                    setLicenseAttachmentName(payload.name);
                    setLicenseAttachmentDataUrl(payload.dataUrl);
                  })} />
                  <small>{licenseAttachmentName || "Pendiente de adjuntar"}</small>
                </label>
                <label className="siniestros-upload-card">Fotos de los danos (max 20)
                  <input type="file" accept=".png,.jpg,.jpeg" multiple onChange={(e) => void attachDamagePhotos(e)} />
                  <small>{damagePhotos.length > 0 ? `${damagePhotos.length}/20 cargadas` : "Sin fotos cargadas"}</small>
                </label>
              </div>
            </section>
            {errorMessage && <p className="hint" style={{ color: "#b42318", gridColumn: "1 / -1" }}>{errorMessage}</p>}
            <div className="siniestros-actions-row siniestros-actions-bar" style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="button primary">{editingId ? "Guardar cambios" : "Guardar datos"}</button>
              {editingId && <button type="button" className="button ghost" onClick={resetForm}>Cancelar</button>}
            </div>
            <datalist id="collision-units">
              {sortedUnits.map((unit) => <option key={unit} value={unit} />)}
            </datalist>
            <datalist id="collision-driver-suggestions">
              {driverSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </form>
        )}
      </section>
      )}

      {activeTab === "calendario" && (
      <section className="panel siniestros-agenda-luxury">
        <div className="panel-head">
          <p className="hint">Este listado se alimenta automaticamente con cada registro guardado.</p>
        </div>
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <h2>Agenda Juicio</h2>
          </div>
          <div className="siniestros-agenda-cards">
            {agendaJuicioRows.length === 0 && <p className="hint">No hay registros en Juicio.</p>}
            {agendaJuicioRows.map((row) => (
              <article key={row.id} className="siniestros-agenda-card">
                <div className="siniestros-agenda-card-head">
                  <strong>{row.unitId}</strong>
                  <span>{row.collisionDate}</span>
                </div>
                <div className="siniestros-agenda-card-grid">
                  <p><span>Conductor</span><strong>{row.incidentDriverName}</strong></p>
                  <p><span>Placa</span><strong>{row.plateSnapshot}</strong></p>
                  <p><span>Modelo y marca</span><strong>{row.brandModelSnapshot}</strong></p>
                  <p><span>Fecha juicio</span><strong>{row.hearingDate}</strong></p>
                  <p><span>Hora juicio</span><strong>{row.hearingTime}</strong></p>
                  <p><span>Juzgado</span><strong>{formatCourtLabel(row.juzgado)}</strong></p>
                  <p><span>No. juzgado</span><strong>{row.courtNumber}</strong></p>
                  <p><span>Colilla</span><strong>{row.colilla}</strong></p>
                  <p><span>Resultado</span><strong>{row.outcome}</strong></p>
                  <p><span>Fecha resolucion</span><strong>{row.resolutionDate}</strong></p>
                  <p><span>Retiro resolucion</span><strong>{row.resolutionWithdrawalDate}</strong></p>
                  <p><span>Factura interna</span><strong>{row.internalInvoiceNumber}</strong></p>
                  <p><span>Adjunto factura</span><strong>{row.internalInvoiceAttachmentName}</strong></p>
                  <p><span>Cedula</span><strong>{row.cedulaAttachmentName}</strong></p>
                  <p><span>Licencia</span><strong>{row.licenseAttachmentName}</strong></p>
                  <p><span>Fotos danos</span><strong>{row.damagePhotosCount}</strong></p>
                </div>
                <p className="siniestros-agenda-note"><span>Notas</span><strong>{row.resultNotes}</strong></p>
                {canEdit && (
                  <div className="siniestros-agenda-actions">
                    <button type="button" className="button danger small" onClick={() => void handleDelete(row.id)}>
                      Eliminar
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-head">
            <h2>Agenda Aseguradora</h2>
          </div>
          <div className="siniestros-agenda-cards">
            {agendaAseguradoraRows.length === 0 && <p className="hint">No hay registros en Aseguradora.</p>}
            {agendaAseguradoraRows.map((row) => (
              <article key={row.id} className="siniestros-agenda-card">
                <div className="siniestros-agenda-card-head">
                  <strong>{row.unitId}</strong>
                  <span>{row.collisionDate}</span>
                </div>
                <div className="siniestros-agenda-card-grid">
                  <p><span>Conductor</span><strong>{row.incidentDriverName}</strong></p>
                  <p><span>Placa</span><strong>{row.plateSnapshot}</strong></p>
                  <p><span>Modelo y marca</span><strong>{row.brandModelSnapshot}</strong></p>
                  <p><span>Lugar del evento</span><strong>{row.eventLocation}</strong></p>
                  <p><span>Aseguradora</span><strong>{row.insurerName}</strong></p>
                  <p><span>Monto</span><strong>{row.insurerInvoiceAmount}</strong></p>
                  <p><span>Factura interna</span><strong>{row.internalInvoiceNumber}</strong></p>
                  <p><span>No. factura aseguradora</span><strong>{row.insurerInvoiceNumber}</strong></p>
                  <p><span>Fecha factura aseguradora</span><strong>{row.insurerInvoiceDate}</strong></p>
                  <p><span>Estado recuperacion</span><strong>{row.insurerRecoveryStatus}</strong></p>
                  <p><span>Fecha pago aseguradora</span><strong>{row.insurerPaymentDate}</strong></p>
                  <p><span>Resultado</span><strong>{row.outcome}</strong></p>
                  <p><span>Fecha resolucion</span><strong>{row.resolutionDate}</strong></p>
                  <p><span>Retiro resolucion</span><strong>{row.resolutionWithdrawalDate}</strong></p>
                  <p><span>Cedula</span><strong>{row.cedulaAttachmentName}</strong></p>
                  <p><span>Licencia</span><strong>{row.licenseAttachmentName}</strong></p>
                  <p><span>Fotos danos</span><strong>{row.damagePhotosCount}</strong></p>
                </div>
                <p className="siniestros-agenda-note"><span>Descripcion de danos</span><strong>{row.damageDescription}</strong></p>
                <p className="siniestros-agenda-note"><span>Notas</span><strong>{row.resultNotes}</strong></p>
                {canEdit && (
                  <div className="siniestros-agenda-actions">
                    <button type="button" className="button danger small" onClick={() => void handleDelete(row.id)}>
                      Eliminar
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
      )}

    </>
  );
}

