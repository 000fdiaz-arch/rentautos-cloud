import { useEffect, useState } from "react";
import { loadCloudOtherChargesRetentionCheckpoints, otherChargesRetentionCheckpointFromRow } from "../cloudData";
import { supabase } from "../lib/supabase";
import type { OtherChargesRetentionCheckpointsByClient } from "../types";

export function useOtherChargesRetentionCheckpoints(ownerUserId?: string | null) {
  const [checkpoints, setCheckpoints] = useState<OtherChargesRetentionCheckpointsByClient>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCheckpoints({});
    setReady(!ownerUserId);
    setError("");
    if (!ownerUserId) return;

    let cancelled = false;
    const reload = async () => {
      try {
        const next = await loadCloudOtherChargesRetentionCheckpoints(ownerUserId);
        if (cancelled) return;
        setCheckpoints(next);
        setReady(true);
        setError("");
      } catch (loadError) {
        console.error("No se pudieron cargar los puntos de control de Otros cargos.", loadError);
        if (cancelled) return;
        setReady(false);
        setError("No se pudo comprobar el ultimo descuento de Otros cargos.");
      }
    };

    void reload();
    const client = supabase;
    if (!client) return () => { cancelled = true; };
    const channel = client
      .channel(`other-charges-retention-checkpoints-${ownerUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "other_charges_retention_checkpoints_cloud",
          filter: `user_id=eq.${ownerUserId}`
        },
        (payload) => {
          const rawRow = payload.eventType === "DELETE" ? payload.old : payload.new;
          const rawClientId = rawRow && typeof rawRow === "object" && "client_id" in rawRow
            ? String(rawRow.client_id ?? "").trim()
            : "";
          setCheckpoints((current) => {
            const next = { ...current };
            if (payload.eventType === "DELETE") {
              if (rawClientId) delete next[rawClientId];
              return next;
            }
            const checkpoint = otherChargesRetentionCheckpointFromRow(rawRow);
            if (checkpoint) next[checkpoint.clientId] = checkpoint;
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [ownerUserId]);

  return { checkpoints, ready, error };
}
