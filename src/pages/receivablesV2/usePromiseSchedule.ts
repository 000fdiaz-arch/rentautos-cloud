import { useEffect, useState } from "react";
import { BUSINESS_TIME_ZONE } from "../../billing";
import { useWorkdayValue } from "./workdayProgress";

export function nextPromiseSchedule(today: string, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", hourCycle: "h23"
  }).format(now));
  const date = hour === 23
    ? new Date(Date.parse(today + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10)
    : today;
  return { date, time: String((hour + 1) % 24).padStart(2, "0") + ":00" };
}

export function usePromiseSchedule(draftKey: string, today: string) {
  const [defaults] = useState(() => nextPromiseSchedule(today));
  const [date, setDate] = useWorkdayValue(draftKey + ":date", defaults.date);
  const [time, setTime] = useWorkdayValue(draftKey + ":time", defaults.time);
  useEffect(() => {
    // Upgrade an empty older draft once, without overwriting a chosen hour
    // or preventing the collector from clearing the input while editing.
    if (!time) setTime(defaults.time);
  }, []);
  return { date, setDate, time, setTime };
}
