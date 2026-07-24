import { useCallback, useEffect, useState } from "react";
import { loadControlUnits, type ControlUnitRow } from "../../cloudData";
import { supabase } from "../../lib/supabase";

export function useControlUnitsRows(dataOwnerUserId?: string | null) {
  const [rows, setRows] = useState<ControlUnitRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  const reloadRows = useCallback(async (): Promise<ControlUnitRow[]> => {
    if (!dataOwnerUserId) {
      setRows([]);
      setLoading(false);
      setLoadError("No se encontro owner de datos para cargar autos.");
      return [];
    }
    const data = await loadControlUnits(dataOwnerUserId);
    setRows(data);
    return data;
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setRows([]);
      setLoading(false);
      setLoadError("No se encontro owner de datos para cargar autos.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void reloadRows()
      .catch((error) => {
        if (cancelled) return;
        console.error("No se pudo cargar autos.", error);
        setLoadError("No se pudo cargar el tablero de autos.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId, reloadRows]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    let cancelled = false;
    let reloadTimer: number | null = null;

    const scheduleReload = () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void reloadRows().catch((error) => {
          if (!cancelled) console.error("No se pudo refrescar autos desde realtime.", error);
        });
      }, 150);
    };

    const channel = client
      .channel(`fleet-units-live-${dataOwnerUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fleet_units_cloud", filter: `user_id=eq.${dataOwnerUserId}` },
        scheduleReload
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId, reloadRows]);

  return { rows, setRows, loading, loadError, reloadRows };
}
