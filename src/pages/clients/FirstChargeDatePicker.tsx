import { useEffect, useId, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { getBusinessDateKey, parseDateKey, toDateKey } from "../../billing";
import { getFirstChargeDatePlanError } from "./clientRules";
import type { ClientForm } from "./clientTypes";
import "./FirstChargeDatePicker.css";

type Props = {
  form: ClientForm;
  setForm: Dispatch<SetStateAction<ClientForm>>;
  errorFields: Set<string>;
  planError: string | null;
  newContract?: boolean;
};

const WEEKDAY_HEADINGS = ["D", "L", "M", "M", "J", "V", "S"];

function monthKeyFromDateKey(dateKey: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey.slice(0, 7) : getBusinessDateKey().slice(0, 7);
}

function shiftMonth(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(year, month - 1 + offset, 1, 12);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthDateKeys(monthKey: string): Array<string | null> {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1, 12);
  const leadingBlanks = firstDay.getDay();
  const daysInMonth = new Date(year, month, 0, 12).getDate();
  const cellCount = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - leadingBlanks + 1;
    return day >= 1 && day <= daysInMonth
      ? toDateKey(new Date(year, month - 1, day, 12))
      : null;
  });
}

function formatFullDate(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return date
    ? date.toLocaleDateString("es-PA", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    : dateKey;
}

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1, 12).toLocaleDateString("es-PA", { month: "long", year: "numeric" });
}

function getScheduleHint(form: ClientForm): string {
  if (form.frequency === "daily") {
    return form.chargeFirstSunday
      ? "Plan diario: todos los dias estan disponibles."
      : "Plan diario: domingos bloqueados.";
  }
  if (form.frequency === "weekly") {
    const dayLabels: Record<ClientForm["weeklyChargeDay"], string> = {
      monday: "lunes",
      tuesday: "martes",
      wednesday: "miercoles",
      thursday: "jueves",
      friday: "viernes",
      saturday: "sabado"
    };
    return `Plan semanal: solo puedes escoger ${dayLabels[form.weeklyChargeDay]}.`;
  }
  if (form.frequency === "biweekly") {
    return "Plan quincenal: solo puedes escoger los dias 15 y 30; en febrero, el ultimo dia.";
  }
  return `Plan mensual: solo puedes escoger el dia ${form.monthlyChargeDay}, ajustado al lunes si cae domingo.`;
}

export function FirstChargeDatePicker({
  form,
  setForm,
  errorFields,
  planError,
  newContract = false
}: Props) {
  const todayKey = getBusinessDateKey();
  const labelId = useId();
  const helpId = useId();
  const calendarId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthKeyFromDateKey(form.firstChargeDate || todayKey));
  const dateKeys = useMemo(() => getMonthDateKeys(visibleMonth), [visibleMonth]);
  const selectedDateLabel = form.firstChargeDate ? formatFullDate(form.firstChargeDate) : "";
  const hasError = errorFields.has("firstChargeDate") || Boolean(planError);
  const earliestMonth = todayKey.slice(0, 7);

  useEffect(() => {
    setVisibleMonth(monthKeyFromDateKey(form.firstChargeDate || todayKey));
    setIsOpen(false);
  }, [form.frequency, form.chargeFirstSunday, form.weeklyChargeDay, form.monthlyChargeDay]);

  const disabledReason = (dateKey: string): string | null => {
    if (newContract && dateKey < todayKey) return "Las fechas anteriores a hoy no estan disponibles.";
    return getFirstChargeDatePlanError({ ...form, firstChargeDate: dateKey });
  };

  const selectDate = (dateKey: string) => {
    if (disabledReason(dateKey)) return;
    setForm((current) => ({ ...current, firstChargeDate: dateKey }));
    setIsOpen(false);
  };

  return (
    <div className="first-charge-date-picker">
      <span id={labelId} className="first-charge-date-label">Fecha primer cobro</span>
      <button
        type="button"
        className={`first-charge-date-trigger${hasError ? " input-error" : ""}`}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={calendarId}
        aria-invalid={hasError}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{selectedDateLabel || "Escoger una fecha compatible"}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {isOpen && (
        <div id={calendarId} className="first-charge-calendar" role="dialog" aria-label="Escoger fecha del primer cobro">
          <div className="first-charge-calendar-header">
            <button
              type="button"
              aria-label="Mes anterior"
              onClick={() => setVisibleMonth((current) => shiftMonth(current, -1))}
              disabled={newContract && visibleMonth <= earliestMonth}
            >
              ‹
            </button>
            <strong aria-live="polite">{formatMonth(visibleMonth)}</strong>
            <button type="button" aria-label="Mes siguiente" onClick={() => setVisibleMonth((current) => shiftMonth(current, 1))}>
              ›
            </button>
          </div>

          <div className="first-charge-calendar-grid" role="grid">
            {WEEKDAY_HEADINGS.map((heading, index) => (
              <span key={`${heading}-${index}`} className="first-charge-calendar-weekday" aria-hidden="true">{heading}</span>
            ))}
            {dateKeys.map((dateKey, index) => {
              if (!dateKey) return <span key={`blank-${index}`} className="first-charge-calendar-blank" aria-hidden="true" />;
              const reason = disabledReason(dateKey);
              const date = parseDateKey(dateKey);
              const isSelected = form.firstChargeDate === dateKey;
              const isToday = dateKey === todayKey;
              return (
                <button
                  key={dateKey}
                  type="button"
                  className={`first-charge-calendar-day${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
                  disabled={Boolean(reason)}
                  aria-label={`${formatFullDate(dateKey)}${reason ? `, no disponible: ${reason}` : ", disponible"}`}
                  aria-selected={isSelected}
                  title={reason ?? "Fecha compatible"}
                  onClick={() => selectDate(dateKey)}
                >
                  {date?.getDate()}
                </button>
              );
            })}
          </div>
          <div className="first-charge-calendar-legend">
            <span><i className="is-compatible" /> Disponible</span>
            <span><i className="is-blocked" /> Bloqueado</span>
          </div>
        </div>
      )}

      <small id={helpId} className={planError ? "form-field-error" : "hint"}>
        {planError ?? (selectedDateLabel ? `Primera letra: ${selectedDateLabel}.` : getScheduleHint(form))}
      </small>
    </div>
  );
}
