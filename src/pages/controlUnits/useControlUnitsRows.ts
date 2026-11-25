import { useCallback, useEffect, useRef, useState } from "react";
import { loadControlUnits, loadRetiredControlUnits, type ControlUnitRow } from "../../cloudData";
import { supabase } from "../../lib/supabase";

type Refresh<T> = { generation: number; queued: boolean; promise: Promise<T> };

function refreshRows<T>(
  ref: { current: Refresh<T> | null },
  generation: number,
  isCurrent: () => boolean,
  load: () => Promise<T>
): Promise<T> {
  if (ref.current?.generation === generation) {
    ref.current.queued = true;
    return ref.current.promise;
  }
  const refresh: Refresh<T> = { generation, queued: false, promise: null! };
  refresh.promise = (async () => {
    let result: { data: T } | { error: unknown };
    do {
      refresh.queued = false;
      try { result = { data: await load() }; }
      catch (error) { result = { error }; }
      // Re-read after changes received during a download. Active and retired
      // fleets have separate queues so a slow history never blocks live autos.
    } while (refresh.queued && isCurrent());
    if ("error" in result) throw result.error;
    return result.data;
  })().finally(() => {
    if (ref.current === refresh) ref.current = null;
  });
  ref.current = refresh;
  return refresh.promise;
}

export function useControlUnitsRows(dataOwnerUserId?: string | null, enabled = true) {
  const [rows, setRows] = useState<ControlUnitRow[]>([]);
  const [retiredRows, setRetiredRows] = useState<ControlUnitRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [retiredLoading, setRetiredLoading] = useState(true);
  const [retiredLoadError, setRetiredLoadError] = useState("");
  const ownerRef = useRef(dataOwnerUserId);
  const generationRef = useRef(0);
  const activeRefreshRef = useRef<Refresh<ControlUnitRow[]> | null>(null);
  const retiredRefreshRef = useRef<Refresh<ControlUnitRow[]> | null>(null);
  ownerRef.current = dataOwnerUserId;

  const reloadRows = useCallback(async (): Promise<ControlUnitRow[]> => {
    if (!dataOwnerUserId) {
      setRows([]);
      setLoading(false);
      setLoadError("No se encontro owner de datos para cargar autos.");
      return [];
    }
    const generation = generationRef.current;
    const isCurrent = () => ownerRef.current === dataOwnerUserId && generationRef.current === generation;
    setLoading(true);
    setLoadError("");
    try {
      const data = await refreshRows(activeRefreshRef, generation, isCurrent, () => loadControlUnits(dataOwnerUserId));
      if (isCurrent()) setRows(data);
      return data;
    } catch (error) {
      if (isCurrent()) setLoadError("No se pudieron cargar los autos activos. Vuelve a intentar.");
      throw error;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [dataOwnerUserId]);

  const reloadRetiredRows = useCallback(async (): Promise<ControlUnitRow[]> => {
    if (!dataOwnerUserId) {
      setRetiredRows([]);
      setRetiredLoading(false);
      return [];
    }
    const generation = generationRef.current;
    const isCurrent = () => ownerRef.current === dataOwnerUserId && generationRef.current === generation;
    setRetiredLoading(true);
    setRetiredLoadError("");
    try {
      const data = await refreshRows(retiredRefreshRef, generation, isCurrent, () => loadRetiredControlUnits(dataOwnerUserId));
      if (isCurrent()) setRetiredRows(data);
      return data;
    } catch (error) {
      if (isCurrent()) setRetiredLoadError("No se pudieron cargar los autos dados de baja. Vuelve a intentar.");
      throw error;
    } finally {
      if (isCurrent()) setRetiredLoading(false);
    }
  }, [dataOwnerUserId]);

  const reloadAllRows = useCallback(async (): Promise<void> => {
    const results = await Promise.allSettled([reloadRows(), reloadRetiredRows()]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }, [reloadRetiredRows, reloadRows]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setRetiredRows([]);
      setLoading(true);
      setRetiredLoading(true);
      setLoadError("");
      setRetiredLoadError("");
      return;
    }
    generationRef.current += 1;
    setRows([]);
    setRetiredRows([]);
    setRetiredLoadError("");
    if (!dataOwnerUserId) {
      setLoading(false);
      setRetiredLoading(false);
      setLoadError("No se encontro owner de datos para cargar autos.");
      return;
    }
    let cancelled = false;
    void reloadAllRows()
      .catch((error) => {
        if (cancelled) return;
        console.error("No se pudo cargar autos.", error);
      });
    return () => {
      cancelled = true;
      generationRef.current += 1;
    };
  }, [dataOwnerUserId, enabled, reloadAllRows]);

  useEffect(() => {
    if (!enabled || !dataOwnerUserId || !supabase) return;
    const client = supabase;
    let cancelled = false;
    let reloadTimer: number | null = null;

    const scheduleReload = () => {
      if (cancelled) return;
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void reloadAllRows().catch((error) => {
          if (!cancelled) console.error("No se pudo refrescar autos desde realtime.", error);
        });
      }, 150);
    };

    // Cada consumidor necesita su propio canal. Supabase no permite agregar
    // callbacks a un canal que otra instancia del hook ya suscribió.
    const channel = client
      .channel(`fleet-units-live-${dataOwnerUserId}-${crypto.randomUUID()}`)
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
  }, [dataOwnerUserId, enabled, reloadAllRows]);

  return { rows, setRows, retiredRows, loading, loadError, retiredLoading, retiredLoadError, reloadRows, reloadRetiredRows, reloadAllRows };
}

export type ControlUnitsRowsState = ReturnType<typeof useControlUnitsRows>;
