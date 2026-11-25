import { useEffect, useRef, useState } from "react";

export function parseDayMonthYear(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return "";
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
  return Number(year) > 0 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`
    ? `${year}-${month}-${day}` : "";
}

const displayDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : "";

export function DayMonthYearInput({ value, onChange, min, id, disabled, required }: {
  value: string; onChange: (value: string) => void; min?: string; id?: string; disabled?: boolean; required?: boolean;
}) {
  const [text, setText] = useState(() => displayDate(value));
  const emitted = useRef(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(displayDate(value));
    }
  }, [value]);
  useEffect(() => {
    const parsed = parseDayMonthYear(text);
    input.current?.setCustomValidity(text && !parsed ? "Escribe una fecha válida: día/mes/año."
      : parsed && min && parsed < min ? "La fecha no puede ser anterior a hoy." : "");
  }, [text, min]);
  return <input ref={input} id={id} type="text" inputMode="numeric" autoComplete="off"
    placeholder="DD/MM/AAAA" aria-label="Fecha (día/mes/año)" maxLength={10}
    required={required} disabled={disabled} value={text}
    onChange={event => {
      const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
      const next = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
      setText(next);
      emitted.current = parseDayMonthYear(next);
      onChange(emitted.current);
    }} />;
}
