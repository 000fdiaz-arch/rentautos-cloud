import { useEffect, useId, useState } from "react";

export function FixedHourField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const [hour, setHour] = useState(() => value ? String(Number(value.slice(0, 2)) % 12 || 12) : "");
  const [period, setPeriod] = useState<"AM" | "PM">(() => Number(value.slice(0, 2)) >= 12 ? "PM" : "AM");
  useEffect(() => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return;
    setHour(String(Number(value.slice(0, 2)) % 12 || 12));
    setPeriod(Number(value.slice(0, 2)) >= 12 ? "PM" : "AM");
    if (!value.endsWith(":00")) onChange(value.slice(0, 2) + ":00");
  }, [value, onChange]);
  function update(nextHour: string, nextPeriod: "AM" | "PM") {
    setHour(nextHour); setPeriod(nextPeriod);
    const numeric = Number(nextHour);
    onChange(numeric >= 1 && numeric <= 12
      ? String(numeric % 12 + (nextPeriod === "PM" ? 12 : 0)).padStart(2, "0") + ":00" : "");
  }
  return <div className="ar-deposit-promise-field ar-deposit-time-field">
    <label htmlFor={id} className="ar-deposit-hour-label">Hora de Panamá</label>
    <div className="ar-deposit-hour-control">
      <div className="ar-deposit-hour-number">
        <input id={id} type="text" inputMode="numeric" autoComplete="off" maxLength={2}
          pattern="(0?[1-9]|1[0-2])" required value={hour} placeholder="Ej. 2"
          aria-label="Hora del depósito, del 1 al 12" onFocus={event => event.currentTarget.select()}
          onChange={event => update(event.target.value.replace(/\D/g, "").slice(0, 2), period)} />
        <span aria-hidden="true">:00</span>
      </div>
      <div className="ar-deposit-period" role="group" aria-label="Período de la hora">
        {(["AM", "PM"] as const).map(item => <button key={item} type="button"
          className={period === item ? "is-active" : ""} aria-pressed={period === item}
          onClick={() => update(hour, item)}>{item}</button>)}
      </div>
    </div>
  </div>;
}
