const enabled = import.meta.env.VITE_PERF_LOGS === "1";
const phases = new Set<string>();
let requestId = 0;

// Resource timings run on the browser's networking clock. Comparing their end
// with observer delivery helps distinguish HTTP delay from a busy main thread.
if (enabled && typeof PerformanceObserver !== "undefined") {
  const entryTypes = PerformanceObserver.supportedEntryTypes ?? [];
  if (entryTypes.includes("resource")) {
    new PerformanceObserver(list => {
      for (const item of list.getEntries()) {
        const entry = item as PerformanceResourceTiming;
        if (entry.initiatorType !== "fetch") continue;
        const endpoint = new URL(entry.name).pathname;
        if (!endpoint.startsWith("/rest/v1/") && !endpoint.startsWith("/storage/v1/")) continue;
        console.info("[Rentautos resource] " + JSON.stringify({ endpoint, startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration), responseEndMs: Math.round(entry.responseEnd), callbackDelayMs: Math.round(performance.now() - entry.responseEnd) }));
      }
    }).observe({ type: "resource", buffered: true });
  }
  if (entryTypes.includes("longtask")) {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        console.info("[Rentautos long task] " + JSON.stringify({ startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration) }));
      }
    }).observe({ type: "longtask", buffered: true });
  }
}

export function markStartupPhase(phase: string): void {
  if (!enabled || phases.has(phase)) return;
  phases.add(phase);
  const atMs = Math.round(performance.now());
  document.documentElement.setAttribute("data-rentautos-navigation-epoch", String(Math.round(performance.timeOrigin)));
  document.documentElement.setAttribute(`data-rentautos-phase-${phase}`, String(atMs));
  document.documentElement.setAttribute(`data-rentautos-phase-${phase}-epoch`, String(Date.now()));
  console.info("[Rentautos startup] " + JSON.stringify({ phase, atMs }));
}

// Log only endpoint names and durations. Never log query strings, headers,
// credentials or response bodies. Keep the original response and AbortSignal.
export const diagnosticFetch: typeof fetch | undefined = enabled ? async (input, init) => {
  const id = ++requestId;
  const endpoint = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
  const startedAt = performance.now();
  try {
    const response = await fetch(input, init);
    console.info("[Rentautos request] " + JSON.stringify({ id, endpoint, startMs: Math.round(startedAt), headersMs: Math.round(performance.now() - startedAt), status: response.status }));
    return response;
  } catch (error) {
    console.info("[Rentautos request] " + JSON.stringify({ id, endpoint, startMs: Math.round(startedAt), failedMs: Math.round(performance.now() - startedAt) }));
    throw error;
  }
} : undefined;

