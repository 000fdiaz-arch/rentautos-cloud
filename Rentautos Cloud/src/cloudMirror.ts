export async function initializeCloudMirror(): Promise<void> {
  // No-op: cloud is the only source of truth now.
}

export async function flushCloudMirror(): Promise<void> {
  // No-op: nothing is cached locally for mirroring.
}

export function writeLocalStorageFromCloud(_key: string, _value: string): void {
  // No-op: local persistence is intentionally disabled.
}

export function disableCloudMirror(): void {
  // No-op: kept for backwards compatibility.
}
