import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { CollectionStatusRecord } from "./receivablesTypes";

// Local drafts and cursor are scoped by account, collector and business date.
// Confirmed outcomes remain authoritative in the database.
export function useWorkdayValue<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); if (raw !== null) return JSON.parse(raw) as T; } catch { /* use defaults */ }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const latest = useRef(value);
  latest.current = value;
  const update = useCallback((action: SetStateAction<T>) => {
    const next = typeof action === "function" ? (action as (previous: T) => T)(latest.current) : action;
    latest.current = next;
    localStorage.setItem(key, JSON.stringify(next));
    setValue(next);
  }, [key]);
  return [value, update] as const;
}

export function latestContact(record: CollectionStatusRecord | undefined, collector: string, date: string) {
  return record?.contactOutcomes?.filter(item => item.collector === collector && item.date === date)
    .sort((a,b) => a.at.localeCompare(b.at)).slice(-1)[0];
}

export function restoredRoundIndex(roundRows: Array<{id:string}>, rows: Array<{id:string}>, selectedId: string | null) {
  const exact = roundRows.findIndex(row => row.id === selectedId);
  if (exact >= 0) return exact;
  const anchor = rows.findIndex(row => row.id === selectedId);
  if (anchor < 0) return 0;
  const next = roundRows.findIndex(row => rows.findIndex(original => original.id === row.id) > anchor);
  return next >= 0 ? next : roundRows.length;
}
export function contactIsDue(record: CollectionStatusRecord | undefined, collector: string, date: string, now: Date) {
  const attempt = latestContact(record, collector, date);
  return attempt?.result === "no_answer" && (!!attempt.followupOf || !attempt.nextContactAt || Date.parse(attempt.nextContactAt) <= now.getTime());
}

/** Adopt the old unscoped cursor only when its selected client belongs to this account. */
export function migrateLegacyWorkdayProgress(owner: string, collector: string, date: string, clientIds: string[]) {
  const source = `cxc.v2.workday.v1:preview:${collector}:${date}`;
  const destination = `cxc.v2.workday.v1:${owner}:${collector}:${date}`;
  const claim = source + ":migrated-owner";
  try {
    if (localStorage.getItem(claim)) return;
    const unit = JSON.parse(localStorage.getItem(source + ":unit") ?? "null") as unknown;
    if (typeof unit !== "string" || !clientIds.includes(unit)) return;
    const keys = Array.from({length:localStorage.length},(_,index)=>localStorage.key(index))
      .filter((key): key is string => !!key && key.startsWith(source + ":"));
    for (const key of keys) {
      const nextKey = destination + key.slice(source.length);
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey,value);
    }
    localStorage.setItem(claim,owner);
  } catch { /* Keep existing drafts untouched when browser storage is unavailable. */ }
}
