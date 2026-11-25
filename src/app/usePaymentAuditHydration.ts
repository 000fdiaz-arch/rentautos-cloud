import { useEffect, useState } from "react";
import { loadCloudManualAssignmentAudit } from "../cloudData";
import { writeLocalStorageFromCloud } from "../cloudMirror";
import { writeIndexedDb } from "../storage/indexedDbStorage";
import { markStartupPhase } from "../lib/startupDiagnostics";

export function usePaymentAuditHydration(ownerUserId: string | undefined, enabled: boolean) {
  const [state, setState] = useState({ owner: "", ready: false, error: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ownerUserId || !enabled) return;
    let cancelled = false;
    setState({ owner: ownerUserId, ready: false, error: "" });
    void (async () => {
      try {
        // Read all pages, then commit the whole snapshot before mounting Payments.
        const rows = await loadCloudManualAssignmentAudit(ownerUserId);
        if (cancelled) return;
        await writeIndexedDb("manual_assignment_audit.v1", rows);
        if (cancelled) return;
        writeLocalStorageFromCloud("cobrapp.module2.manual_assignment_audit.v1", "__indexeddb__");
        setState({ owner: ownerUserId, ready: true, error: "" });
        markStartupPhase("payment-audit-ready");
      } catch (error) {
        if (cancelled) return;
        console.error("No se pudo cargar la auditoria de pagos.", error);
        setState({ owner: ownerUserId, ready: false, error: "No se pudo cargar la auditoria de pagos. Vuelve a intentar." });
      }
    })();
    return () => { cancelled = true; };
  }, [ownerUserId, enabled, attempt]);

  return {
    ready: !ownerUserId || (enabled && state.owner === ownerUserId && state.ready),
    error: state.owner === ownerUserId ? state.error : "",
    retry: () => setAttempt(value => value + 1)
  };
}
