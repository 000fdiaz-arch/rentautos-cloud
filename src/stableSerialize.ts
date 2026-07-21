function normalizeForStableSerialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeForStableSerialize(item));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      acc[key] = normalizeForStableSerialize(record[key]);
      return acc;
    }, {} as Record<string, unknown>);
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForStableSerialize(value));
}

export function stableEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  return stableSerialize(left) === stableSerialize(right);
}
