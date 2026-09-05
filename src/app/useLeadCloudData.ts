import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadEvaluation } from "../types";
import { stableEqual } from "../stableSerialize";
import { sellerCedulaKey } from "../sellerLeadPortalRules";
import { loadCloudLeadPage, findCloudLeadByCedula, type LeadCursor } from "../cloud/leadReadCloudData";
import { loadCloudLeadEvaluation, saveCloudLeadEvaluation, deleteCloudLeadEvaluation } from "../cloud/operationsCloudData";

function merge(current: LeadEvaluation[], incoming: LeadEvaluation[]): LeadEvaluation[] {
  const byId = new Map(current.map(item => [item.id, item]));
  incoming.forEach(item => byId.set(item.id, item));
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

export function useLeadCloudData(userId: string | undefined, enabled: boolean, active: boolean) {
  const [evaluations, setEvaluations] = useState<LeadEvaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<LeadCursor | null>(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const currentOwner = useRef(userId);
  currentOwner.current = userId;
  const currentEvaluations = useRef(evaluations);
  currentEvaluations.current = evaluations;
  const loadingMore = useRef(false);
  const initialLoaded = useRef(false);
  const revision = useRef(0);
  const changedSinceRead = useRef(new Map<string, { revision: number; item: LeadEvaluation | null }>());

  function recordChange(id: string, item: LeadEvaluation | null): void {
    changedSinceRead.current.set(id, { revision: ++revision.current, item });
  }

  function reconcileRead(items: LeadEvaluation[], readRevision: number): LeadEvaluation[] {
    const byId = new Map(items.map(item => [item.id, item]));
    changedSinceRead.current.forEach((change, id) => {
      if (change.revision <= readRevision) return;
      if (change.item) byId.set(id, change.item);
      else byId.delete(id);
    });
    return merge([], [...byId.values()]);
  }

  useEffect(() => {
    generation.current++;
    initialLoaded.current = false;
    changedSinceRead.current.clear();
    loadingMore.current = false;
    setEvaluations([]);
    setCursor(null);
    setError("");
    setLoading(false);
  }, [userId, enabled]);

  useEffect(() => {
    if (!enabled || !active || !userId) return;
    let cancelled = false;
    const version = generation.current;
    const readRevision = revision.current;
    setLoading(true);
    setError("");
    void loadCloudLeadPage(userId).then(page => {
      if (cancelled || version !== generation.current) return;
      // Keep a lookup completed during the initial request. A manual refresh
      // replaces the old history, so removed server records are not cached forever.
      const replace = initialLoaded.current;
      setEvaluations(current => reconcileRead(replace ? page.items : merge(page.items, current), readRevision));
      setCursor(page.nextCursor);
      initialLoaded.current = true;
    }).catch(() => {
      if (!cancelled && version === generation.current) setError("No se pudieron cargar los dictámenes recientes. Puedes reintentar o consultar una cédula.");
    }).finally(() => {
      if (!cancelled && version === generation.current) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, enabled, active, reload]);

  const refresh = useCallback(() => setReload(value => value + 1), []);

  async function loadMore(): Promise<void> {
    if (!userId || !cursor || loading || loadingMore.current) return;
    const version = generation.current;
    const readRevision = revision.current;
    loadingMore.current = true;
    setLoading(true);
    setError("");
    try {
      const page = await loadCloudLeadPage(userId, cursor);
      if (version !== generation.current) return;
      setEvaluations(current => reconcileRead(merge(current, page.items), readRevision));
      setCursor(page.nextCursor);
    } catch {
      if (version === generation.current) setError("No se pudieron cargar más dictámenes. Intenta nuevamente.");
    } finally {
      if (version === generation.current) { setLoading(false); loadingMore.current = false; }
    }
  }

  async function find(cedula: string): Promise<LeadEvaluation | null> {
    if (!userId || !enabled) throw new Error("No hay acceso a los Leads.");
    const owner = userId;
    const version = generation.current;
    const item = await findCloudLeadByCedula(owner, cedula);
    if (owner !== currentOwner.current || version !== generation.current) throw new Error("La sesión cambió. Consulta nuevamente.");
    if (item) { recordChange(item.id, item); setEvaluations(current => merge(current, [item])); }
    else {
      const key = sellerCedulaKey(cedula);
      currentEvaluations.current.filter(row => sellerCedulaKey(row.cedula) === key).forEach(row => recordChange(row.id, null));
      setEvaluations(current => current.filter(row => sellerCedulaKey(row.cedula) !== key));
    }
    return item;
  }

  async function loadDocument(id: string): Promise<LeadEvaluation | null> {
    if (!userId || !enabled) throw new Error("No hay acceso a los Leads.");
    const owner = userId;
    const item = await loadCloudLeadEvaluation(owner, id);
    if (owner !== currentOwner.current) throw new Error("La sesión cambió.");
    // Large documents stay in the current view, never in the history cache.
    return item;
  }

  async function persist(next: LeadEvaluation[]): Promise<void> {
    if (!userId || !enabled) throw new Error("No hay acceso a los Leads.");
    const owner = userId;
    const previous = currentEvaluations.current;
    const previousById = new Map(previous.map(item => [item.id, item]));
    const nextById = new Map(next.map(item => [item.id, item]));
    const changed = next.filter(item => !stableEqual(previousById.get(item.id), item));
    const removed = previous.filter(item => !nextById.has(item.id));
    for (const item of changed) await saveCloudLeadEvaluation(owner, item);
    for (const item of removed) await deleteCloudLeadEvaluation(owner, item.id);
    if (owner !== currentOwner.current) return;
    setEvaluations(current => merge(current.filter(item => !removed.some(row => row.id === item.id)), changed.map(item => {
      const { attachmentDataUrl: _document, ...summary } = item;
      return summary;
    })));
  }

  async function save(item: LeadEvaluation): Promise<void> {
    if (!userId || !enabled) throw new Error("No hay acceso a los Leads.");
    const owner = userId;
    await saveCloudLeadEvaluation(owner, item);
    if (owner !== currentOwner.current) return;
    const { attachmentDataUrl: _document, ...summary } = item;
    recordChange(item.id, summary);
    setEvaluations(current => merge(current, [summary]));
  }

  async function remove(id: string): Promise<void> {
    if (!userId || !enabled) throw new Error("No hay acceso a los Leads.");
    const owner = userId;
    await deleteCloudLeadEvaluation(owner, id);
    if (owner === currentOwner.current) {
      recordChange(id, null);
      setEvaluations(current => current.filter(item => item.id !== id));
    }
  }

  return { evaluations, loading, error, hasMore: cursor !== null, refresh, loadMore, find, loadDocument, persist, save, remove };
}
