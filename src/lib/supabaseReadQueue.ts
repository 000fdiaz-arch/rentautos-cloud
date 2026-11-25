const READ_RPCS = new Set([
  "read_clients_snapshot_if_changed", "read_control_units_snapshot",
  "read_cloud_mirror_snapshot", "read_initial_payments_snapshot", "read_pending_cash_payments"
]);
const CORE_TABLES = new Set(["user_profiles", "clients_cloud", "payments_cloud", "vw_control_unidades"]);

// Bound concurrent database work during bootstrap. Keep native Responses,
// request options and bodies intact; mutations/auth/storage bypass the queue.
export function createSupabaseReadQueue(transport: typeof fetch, origin: string, limit = 4): typeof fetch {
  type Waiting = { critical: boolean; start: () => void; cancel: () => void };
  const waiting: Waiting[] = [];
  let active = 0;
  let activeBackground = 0;
  const backgroundLimitDuringCore = 1;
  const drain = () => {
    while (active < limit && waiting.length) {
      const criticalIndex = waiting.findIndex(item => item.critical);
      // While core reads run, leave room for the remaining core requests,
      // including those whose local checksum is still being calculated.
      if (criticalIndex < 0 && active > activeBackground && activeBackground >= backgroundLimitDuringCore) break;
      const index = criticalIndex >= 0 ? criticalIndex : 0;
      waiting.splice(index, 1)[0].start();
    }
  };
  return (input, init) => {
    let url: URL;
    try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); }
    catch { return transport(input, init); }
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const target = url.pathname.replace(/^\/rest\/v1\//, "");
    const readRpc = target.startsWith("rpc/") && READ_RPCS.has(target.slice(4));
    const read = url.origin === origin && url.pathname.startsWith("/rest/v1/") && (
      method === "GET" || method === "HEAD" ||
      (method === "POST" && readRpc)
    );
    if (!read) return transport(input, init);
    const critical = readRpc || CORE_TABLES.has(target);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return new Promise<Response>((resolve, reject) => {
      let started = false;
      const abortError = () => signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
      const item: Waiting = {
        critical,
        start: () => {
          signal?.removeEventListener("abort", item.cancel);
          if (signal?.aborted) { reject(abortError()); return; }
          started = true;
          active++;
          if (!critical) activeBackground++;
          // Release at response headers without buffering or cloning the body.
          // Body streaming and consumption remain native and unmodified.
          void Promise.resolve().then(() => transport(input, init)).then(resolve, reject).finally(() => {
            active--;
            if (!critical) activeBackground--;
            drain();
          });
        },
        cancel: () => {
          if (started) return;
          const index = waiting.indexOf(item);
          if (index >= 0) waiting.splice(index, 1);
          signal?.removeEventListener("abort", item.cancel);
          reject(abortError());
          drain();
        }
      };
      if (signal?.aborted) { reject(abortError()); return; }
      signal?.addEventListener("abort", item.cancel, { once: true });
      waiting.push(item);
      drain();
    });
  };
}
