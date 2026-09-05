import { useEffect, useState } from "react";
import { countPendingSellerLeadReviews, SELLER_LEAD_REQUESTS_CHANGED_EVENT } from "../cloud/sellerLeadRequestCloudData";

// Count only; never fetch documents or infer the total from a paginated list.
export function usePendingLeadReviewCount(ownerUserId: string | undefined, enabled: boolean): number {
  const [snapshot, setSnapshot] = useState<{ owner: string; count: number } | null>(null);

  useEffect(() => {
    setSnapshot(null);
    if (!ownerUserId || !enabled) return;
    let cancelled = false;
    let loading = false;
    let reloadRequested = false;

    async function refresh(): Promise<void> {
      if (cancelled || document.visibilityState === "hidden") return;
      if (loading) { reloadRequested = true; return; }
      loading = true;
      try {
        const count = await countPendingSellerLeadReviews(ownerUserId!);
        if (!cancelled) setSnapshot({ owner: ownerUserId!, count });
      } catch {
        // A temporary error must not falsely clear pending work.
        console.warn("No se pudo actualizar el contador de licencias pendientes.");
      } finally {
        loading = false;
        if (reloadRequested && !cancelled) {
          reloadRequested = false;
          void refresh();
        }
      }
    }

    const onChange = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(onChange, 30_000);
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener(SELLER_LEAD_REQUESTS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener(SELLER_LEAD_REQUESTS_CHANGED_EVENT, onChange);
    };
  }, [ownerUserId, enabled]);

  return enabled && snapshot && snapshot.owner === ownerUserId ? snapshot.count : 0;
}
