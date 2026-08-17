import type { OtherCharge } from "./types";

function validChargeDate(value: string | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return value;
}

export function sortOtherChargesOldestFirst(charges: OtherCharge[] | undefined): OtherCharge[] {
  return (charges ?? [])
    .map((charge, index) => ({ charge, index, date: validChargeDate(charge.createdAt) }))
    .sort((left, right) => {
      if (!left.date && !right.date) return left.index - right.index;
      if (!left.date) return -1;
      if (!right.date) return 1;
      const dateComparison = left.date.localeCompare(right.date);
      return dateComparison !== 0 ? dateComparison : left.index - right.index;
    })
    .map(({ charge }) => charge);
}

export function otherChargeDateKey(charge: Pick<OtherCharge, "createdAt">): string {
  const value = validChargeDate(charge.createdAt);
  return value ? value.slice(0, 10) : "";
}
