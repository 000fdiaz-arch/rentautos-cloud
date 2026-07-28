function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function newerIso(left, right) {
  const leftText = typeof left === "string" ? left : "";
  const rightText = typeof right === "string" ? right : "";
  const leftMs = leftText ? new Date(leftText).getTime() : 0;
  const rightMs = rightText ? new Date(rightText).getTime() : 0;
  return (Number.isFinite(leftMs) ? leftMs : 0) >= (Number.isFinite(rightMs) ? rightMs : 0) ? leftText : rightText;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordTimestamp(value) {
  if (!isPlainRecord(value)) return "";
  return newerIso(
    newerIso(value.updatedAt, value.managementUpdatedAt),
    newerIso(value.supportNoteUpdatedAt, value.routeReleaseUpdatedAt)
  );
}

function mergeStreetManagement(current, incoming) {
  const merged = { ...current };
  const currentClearedAt = recordTimestamp(current.__clearedAt);
  const incomingClearedAt = recordTimestamp(incoming.__clearedAt);
  const clearedAt = newerIso(currentClearedAt, incomingClearedAt);
  for (const clientId of Object.keys(current)) {
    if (clientId === "__clearedAt") continue;
    if (!(clientId in incoming)) delete merged[clientId];
  }
  if (incomingClearedAt) merged.__clearedAt = incoming.__clearedAt;
  else if (currentClearedAt) merged.__clearedAt = current.__clearedAt;
  for (const [clientId, incomingValue] of Object.entries(incoming)) {
    if (clientId === "__clearedAt") continue;
    if (!isPlainRecord(incomingValue)) continue;
    if (clearedAt && newerIso(clearedAt, recordTimestamp(incomingValue)) === clearedAt) continue;
    const currentValue = merged[clientId];
    if (!isPlainRecord(currentValue) || newerIso(recordTimestamp(currentValue), recordTimestamp(incomingValue)) === recordTimestamp(incomingValue)) {
      merged[clientId] = incomingValue;
    }
  }
  return merged;
}

function mergeDelta(currentData, previousValue, nextValue) {
  const changedPatch = {};
  for (const [clientId, nextRow] of Object.entries(nextValue)) {
    const prevRow = previousValue[clientId];
    const nextTs = Date.parse(recordTimestamp(nextRow)) || 0;
    const prevTs = Date.parse(recordTimestamp(prevRow)) || 0;
    if (!prevRow || nextTs >= prevTs) {
      if (JSON.stringify(prevRow) !== JSON.stringify(nextRow)) changedPatch[clientId] = nextRow;
    }
  }
  for (const clientId of Object.keys(previousValue)) {
    if (!(clientId in nextValue)) changedPatch[clientId] = null;
  }

  const merged = { ...currentData };
  const clearedAt = Date.parse(recordTimestamp(currentData.__clearedAt)) || 0;
  for (const [clientId, patchValue] of Object.entries(changedPatch)) {
    if (clientId === "__clearedAt") {
      if ((Date.parse(recordTimestamp(patchValue)) || 0) >= clearedAt) merged.__clearedAt = patchValue;
      continue;
    }
    if (patchValue === null) {
      delete merged[clientId];
      continue;
    }
    const patchTs = Date.parse(recordTimestamp(patchValue)) || 0;
    const currentTs = Date.parse(recordTimestamp(merged[clientId])) || 0;
    if (clearedAt > 0 && patchTs <= clearedAt) continue;
    if (!merged[clientId] || patchTs >= currentTs) merged[clientId] = patchValue;
  }
  return merged;
}

const initial = {
  c1: { status: "pending", comment: "", updatedAt: "2026-07-26T10:00:00.000Z" }
};

const userA = {
  c1: { status: "contacted", comment: "", updatedAt: "2026-07-26T10:05:00.000Z" }
};
const userB = {
  c1: { status: "route", comment: "", updatedAt: "2026-07-26T10:04:00.000Z", routeReleaseAmount: 100, routeReleaseUpdatedAt: "2026-07-26T10:04:00.000Z" }
};

let cloud = mergeDelta(initial, initial, userA);
cloud = mergeDelta(cloud, initial, userB);
assert(cloud.c1.status === "contacted", "El estado mas nuevo debe ganar en concurrencia.");

cloud = {
  __clearedAt: { updatedAt: "2026-07-26T22:00:00.000Z" }
};
const staleBrowserUpload = {
  c1: { status: "route", comment: "", updatedAt: "2026-07-26T10:04:00.000Z", routeReleaseAmount: 100 }
};
const afterStaleDelta = mergeDelta(cloud, {}, staleBrowserUpload);
assert(!afterStaleDelta.c1, "Estados viejos no deben reaparecer despues del cierre.");

const mirrorMerge = mergeStreetManagement(cloud, staleBrowserUpload);
assert(!mirrorMerge.c1, "Mirror local no debe resucitar estados anteriores al cierre.");

const nextDayUpdate = {
  c1: { status: "pending", comment: "", updatedAt: "2026-07-27T08:00:00.000Z" }
};
const afterNextDay = mergeDelta(cloud, {}, nextDayUpdate);
assert(afterNextDay.c1.status === "pending", "Estados nuevos posteriores al cierre si deben guardarse.");

console.log("OK receivables multiuser merge: concurrencia y limpieza anti-resurreccion validadas.");
