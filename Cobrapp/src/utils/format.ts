const moneyFormatter = new Intl.NumberFormat("es-PA", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("es-PA", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function parseDateValue(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

export function formatDate(value: string) {
  const parsed = parseDateValue(value);

  if (!parsed) {
    return value || "Sin fecha";
  }

  return dateFormatter.format(parsed);
}
