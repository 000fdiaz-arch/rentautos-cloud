import type { OtherChargesRetentionWeeklyDay } from "./types";

export const OTHER_CHARGES_WEEKDAYS: OtherChargesRetentionWeeklyDay[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
];

export const OTHER_CHARGES_WEEKDAY_LABEL: Record<OtherChargesRetentionWeeklyDay, string> = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miercoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sabado",
  sunday: "Domingo"
};

export function normalizeOtherChargesWeeklyDay(value: unknown): OtherChargesRetentionWeeklyDay | undefined {
  return OTHER_CHARGES_WEEKDAYS.includes(value as OtherChargesRetentionWeeklyDay)
    ? value as OtherChargesRetentionWeeklyDay
    : undefined;
}
