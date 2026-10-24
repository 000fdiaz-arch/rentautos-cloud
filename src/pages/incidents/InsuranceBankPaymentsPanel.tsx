import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadInsuranceBankPayments,
  loadInsuranceClaims,
  loadControlUnits,
  returnInsuranceBankPaymentToPayments,
  setInsuranceBankPaymentClaim,
  type ControlUnitRow,
  type InsuranceBankPaymentRecord,
  type InsuranceClaimRecord
} from "../../cloudData";
import { formatCurrency } from "../../format";
import { supabase } from "../../lib/supabase";
import { buildInsurancePaymentClaimSuggestions } from "./insurancePaymentMatching";

type Props = {
  dataOwnerUserId?: string | null;
  readOnly: boolean;
  refreshKey?: number;
  onOpenClaim: (claimId: string) => void;
  onPendingCountChange?: (count: number) => void;
};

type StatusFilter = "pending" | "linked";

function formatShortDate(value: string): string {
  if (!value) return "-";
  const parsed = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("es-PA", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function claimIdentity(claim: InsuranceClaimRecord): string {
  return `${claim.unit || "Sin unidad"} · ${claim.claimNumber ? `Expediente N.º ${claim.claimNumber}` : "Sin número de expediente"} · ${claim.insurer || "Sin aseguradora"}`;
}

function claimSearchText(claim: InsuranceClaimRecord): string {
  return [claim.unit, claim.claimNumber, claim.amount, claim.insurer, claim.driver, claim.plate, claim.incidentDate, claim.status]
    .join(" ")
    .toLocaleLowerCase("es");
}

function normalizeUnitKey(value: string): string {
  return value.trim().toLocaleUpperCase("es").replace(/\s+/g, "");
}

function unitGroup(value: string): string {
  return normalizeUnitKey(value).match(/^([A-Z]+)/)?.[1] ?? "";
}

function claimOptionLabel(claim: InsuranceClaimRecord): string {
  return `${claimIdentity(claim)} · Monto ${claim.amount} · ${claim.driver || "Sin conductor"} · ${claim.plate || "Sin placa"}`;
}

function hasLinkableClaimData(claim: InsuranceClaimRecord): boolean {
  const normalized = claim.claimNumber.trim().replace(/[^A-Z0-9]/gi, "");
  const normalizedAmount = claim.amount.replace(/[^0-9.,-]/g, "").trim();
  const lastComma = normalizedAmount.lastIndexOf(",");
  const lastDot = normalizedAmount.lastIndexOf(".");
  const decimalMark = lastComma > lastDot ? "," : ".";
  const thousandsMark = decimalMark === "," ? "." : ",";
  const parsedAmount = Number(normalizedAmount.split(thousandsMark).join("").replace(decimalMark, "."));
  return normalized.length >= 2
    && !/^0+$/.test(normalized)
    && normalizedAmount.length > 0
    && Number.isFinite(parsedAmount)
    && parsedAmount > 0;
}

export default function InsuranceBankPaymentsPanel({ dataOwnerUserId, readOnly, refreshKey = 0, onOpenClaim, onPendingCountChange }: Props) {
  const [records, setRecords] = useState<InsuranceBankPaymentRecord[]>([]);
  const [claims, setClaims] = useState<InsuranceClaimRecord[]>([]);
  const [fleetUnits, setFleetUnits] = useState<ControlUnitRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selectedId, setSelectedId] = useState("");
  const [manualClaimId, setManualClaimId] = useState("");
  const [manualSearch, setManualSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!dataOwnerUserId) {
      setRecords([]);
      setClaims([]);
      setFleetUnits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [nextRecords, nextClaims, nextFleetUnits] = await Promise.all([
        loadInsuranceBankPayments(dataOwnerUserId),
        loadInsuranceClaims(dataOwnerUserId),
        loadControlUnits(dataOwnerUserId).catch((fleetError) => {
          console.error("No se pudo cargar la empresa de las unidades para sugerencias de Seguros.", fleetError);
          return [];
        })
      ]);
      setRecords(nextRecords);
      setClaims(nextClaims);
      setFleetUnits(nextFleetUnits);
    } catch (loadError) {
      console.error("No se pudieron cargar los pagos enviados a Seguros.", loadError);
      setError("No se pudieron cargar los pagos enviados a Seguros.");
    } finally {
      setLoading(false);
    }
  }, [dataOwnerUserId]);

  useEffect(() => { void reload(); }, [reload, refreshKey]);

  useEffect(() => {
    const client = supabase;
    if (!dataOwnerUserId || !client) return;
    const channel = client
      .channel(`insurance-bank-payments-${dataOwnerUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "insurance_bank_payments_cloud", filter: `user_id=eq.${dataOwnerUserId}` },
        () => { void reload(); }
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [dataOwnerUserId, reload]);

  const filteredRecords = useMemo(
    () => records.filter((record) => record.status === statusFilter),
    [records, statusFilter]
  );
  const pendingCount = useMemo(() => records.filter((record) => record.status === "pending").length, [records]);
  const linkedCount = records.length - pendingCount;

  useEffect(() => {
    onPendingCountChange?.(pendingCount);
  }, [onPendingCountChange, pendingCount]);

  useEffect(() => {
    if (filteredRecords.some((record) => record.id === selectedId)) return;
    setSelectedId(filteredRecords[0]?.id ?? "");
  }, [filteredRecords, selectedId]);

  const selectedRecord = filteredRecords.find((record) => record.id === selectedId) ?? null;
  const companyByUnit = useMemo(() => {
    const map = new Map<string, string>();
    fleetUnits.forEach((unit) => {
      const key = normalizeUnitKey(unit.unit_id);
      const company = unit.company?.trim();
      if (key && company) map.set(key, company);
    });
    return map;
  }, [fleetUnits]);
  const companyByGroup = useMemo(() => {
    const map = new Map<string, string>();
    fleetUnits.forEach((unit) => {
      const group = unitGroup(unit.unit_id);
      const company = unit.company?.trim();
      if (group && company && !map.has(group)) map.set(group, company);
    });
    return map;
  }, [fleetUnits]);
  const suggestions = useMemo(
    () => selectedRecord ? buildInsurancePaymentClaimSuggestions(selectedRecord, claims, { companyByUnit, companyByGroup }) : [],
    [claims, companyByGroup, companyByUnit, selectedRecord]
  );
  const linkedClaim = selectedRecord?.claimId
    ? claims.find((claim) => claim.id === selectedRecord.claimId) ?? null
    : null;
  const manualClaims = useMemo(() => {
    const query = manualSearch.trim().toLocaleLowerCase("es");
    const completeClaims = claims.filter(hasLinkableClaimData);
    if (!query) return completeClaims.slice(0, 100);
    return completeClaims.filter((claim) => `${claimSearchText(claim)} ${companyByUnit.get(normalizeUnitKey(claim.unit)) ?? ""}`.toLocaleLowerCase("es").includes(query)).slice(0, 100);
  }, [claims, companyByUnit, manualSearch]);
  const manualClaim = manualClaimId
    ? claims.find((claim) => claim.id === manualClaimId) ?? null
    : null;
  const selectedPaymentGroup = normalizeUnitKey(selectedRecord?.bankItem.mappedGroup ?? "");
  const selectedPaymentCompany = selectedPaymentGroup ? companyByGroup.get(selectedPaymentGroup) ?? "" : "";

  useEffect(() => {
    setManualClaimId("");
    setManualSearch("");
  }, [selectedRecord?.id]);

  async function linkPayment(claimId: string): Promise<void> {
    if (!dataOwnerUserId || !selectedRecord || !claimId || saving) return;
    const claim = claims.find((candidate) => candidate.id === claimId);
    if (!claim) {
      setError("El expediente seleccionado ya no está disponible.");
      return;
    }
    if (!hasLinkableClaimData(claim)) {
      setError("El expediente debe tener número y monto registrados antes de poder vincularlo.");
      return;
    }
    if (!window.confirm(`Vincular el folio ${selectedRecord.id} con ${claimIdentity(claim)}?`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await setInsuranceBankPaymentClaim(dataOwnerUserId, selectedRecord.id, claimId);
      setRecords((current) => current.map((record) => record.id === updated.id ? updated : record));
      setStatusFilter("linked");
      setSelectedId(updated.id);
      setMessage(`Pago ${updated.id} vinculado con ${claimIdentity(claim)}.`);
      window.dispatchEvent(new Event("cobrapp:insurance-bank-updated"));
    } catch (saveError) {
      console.error("No se pudo vincular el pago de seguro.", saveError);
      setError(saveError instanceof Error ? saveError.message : "No se pudo vincular el pago de seguro.");
    } finally {
      setSaving(false);
    }
  }

  async function unlinkPayment(): Promise<void> {
    if (!dataOwnerUserId || !selectedRecord || saving) return;
    if (!window.confirm(`Desvincular el folio ${selectedRecord.id} de su expediente?`)) return;
    setSaving(true);
    setError("");
    try {
      const updated = await setInsuranceBankPaymentClaim(dataOwnerUserId, selectedRecord.id, null);
      setRecords((current) => current.map((record) => record.id === updated.id ? updated : record));
      setStatusFilter("pending");
      setSelectedId(updated.id);
      setMessage(`Pago ${updated.id} devuelto a la bandeja por identificar.`);
      window.dispatchEvent(new Event("cobrapp:insurance-bank-updated"));
    } catch (saveError) {
      console.error("No se pudo desvincular el pago de seguro.", saveError);
      setError(saveError instanceof Error ? saveError.message : "No se pudo desvincular el pago de seguro.");
    } finally {
      setSaving(false);
    }
  }

  async function returnToPayments(): Promise<void> {
    if (!dataOwnerUserId || !selectedRecord || saving) return;
    if (!window.confirm(`Devolver el folio ${selectedRecord.id} a Pendientes del banco?`)) return;
    setSaving(true);
    setError("");
    try {
      await returnInsuranceBankPaymentToPayments(dataOwnerUserId, selectedRecord.id);
      setRecords((current) => current.filter((record) => record.id !== selectedRecord.id));
      setMessage(`Pago ${selectedRecord.id} devuelto a Pagos.`);
      window.dispatchEvent(new Event("cobrapp:insurance-bank-updated"));
    } catch (saveError) {
      console.error("No se pudo devolver el movimiento a Pagos.", saveError);
      setError(saveError instanceof Error ? saveError.message : "No se pudo devolver el movimiento a Pagos.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel insurance-bank-payments-panel" aria-labelledby="insurance-bank-payments-title">
      <div className="panel-head insurance-bank-payments-head">
        <div>
          <span className="workflow-eyebrow">Integración bancaria</span>
          <h2 id="insurance-bank-payments-title">Pagos enviados a Seguros</h2>
          <p className="hint">Vincula cada movimiento con su expediente. Estos pagos no afectan saldos ni generan recibos de clientes.</p>
        </div>
        <button type="button" className="button ghost small" onClick={() => void reload()} disabled={loading || saving}>Actualizar</button>
      </div>

      <div className="insurance-bank-payment-tabs" role="tablist" aria-label="Estado de pagos de seguros">
        <button type="button" role="tab" aria-selected={statusFilter === "pending"} className={statusFilter === "pending" ? "active" : ""} onClick={() => setStatusFilter("pending")}>Por identificar <b>{pendingCount}</b></button>
        <button type="button" role="tab" aria-selected={statusFilter === "linked"} className={statusFilter === "linked" ? "active" : ""} onClick={() => setStatusFilter("linked")}>Vinculados <b>{linkedCount}</b></button>
      </div>

      {message && <div className="workflow-message" role="status"><span>{message}</span><button type="button" className="button ghost small" onClick={() => setMessage("")}>Cerrar</button></div>}
      {error && <p className="hint error-text" role="alert">{error}</p>}
      {loading ? <p className="empty">Cargando pagos de seguros...</p> : filteredRecords.length === 0 ? (
        <p className="empty">{statusFilter === "pending" ? "No hay pagos de seguros por identificar." : "Todavía no hay pagos vinculados."}</p>
      ) : (
        <div className="insurance-bank-payment-workspace">
          <div className="insurance-bank-payment-list" aria-label="Pagos enviados desde el banco">
            {filteredRecords.map((record) => (
              <button
                type="button"
                key={record.id}
                className={`insurance-bank-payment-card${record.id === selectedRecord?.id ? " selected" : ""}`}
                onClick={() => setSelectedId(record.id)}
              >
                <span><b>{record.bankItem.extractedName || "Movimiento bancario"}</b><small>{record.bankItem.description || "Sin descripción"}</small></span>
                <span><strong>{formatCurrency(record.bankItem.amountReceived)}</strong><small>{record.id} · {formatShortDate(record.bankItem.dateApplied)}</small></span>
              </button>
            ))}
          </div>

          {selectedRecord && <aside className="insurance-bank-payment-match">
            <div className="insurance-bank-payment-match-head">
              <div>
                <small>Folio bancario</small>
                <strong>{selectedRecord.id}</strong>
                <small>{selectedPaymentGroup ? `Grupo ${selectedPaymentGroup}` : "Grupo no identificado"}{selectedPaymentCompany ? ` · ${selectedPaymentCompany}` : ""}</small>
              </div>
              <strong>{formatCurrency(selectedRecord.bankItem.amountReceived)}</strong>
            </div>

            {selectedRecord.status === "linked" ? (
              linkedClaim ? <>
                <span className="insurance-match-confidence high">Pago vinculado</span>
                <h3>{claimIdentity(linkedClaim)}</h3>
                <dl className="insurance-bank-payment-details">
                  <div><dt>N.º de expediente</dt><dd>{linkedClaim.claimNumber}</dd></div>
                  <div><dt>Monto reclamado</dt><dd>{linkedClaim.amount || "No registrado"}</dd></div>
                  <div><dt>Folio recibido</dt><dd>{selectedRecord.id}</dd></div>
                  <div><dt>Vinculado</dt><dd>{formatShortDate(selectedRecord.linkedAt ?? "")}</dd></div>
                </dl>
                <div className="insurance-bank-payment-actions">
                  <button type="button" className="button primary" onClick={() => onOpenClaim(linkedClaim.id)}>Ver expediente</button>
                  {!readOnly && <button type="button" className="button ghost" disabled={saving} onClick={() => void unlinkPayment()}>Desvincular</button>}
                </div>
              </> : <p className="hint error-text">El expediente vinculado ya no está disponible.</p>
            ) : <>
              <div className="insurance-linking-guide">
                <strong>Cómo identificarlo</strong>
                <ol>
                  <li>Solo se muestran expedientes que ya tienen número y monto registrados.</li>
                  <li>Compara el número de expediente y el monto del banco.</li>
                  <li>Confirma unidad, placa, conductor y aseguradora.</li>
                  <li>Solo entonces pulsa “Vincular este expediente”.</li>
                </ol>
              </div>
              <h3>Sugerencias de expediente</h3>
              <p className="hint">Ordenadas de mayor a menor similitud con el movimiento bancario.</p>
              {suggestions.length === 0 ? <p className="hint">No encontramos un expediente válido que coincida. Para sugerirlo debe tener número de expediente y monto registrados.</p> : (
                <div className="insurance-claim-suggestions">
                  {suggestions.map((suggestion, index) => (
                    <article key={suggestion.claim.id} className={index === 0 ? "best" : ""}>
                      <div>
                        <strong>{index === 0 ? "1. Mejor sugerencia" : `${index + 1}. Siguiente sugerencia`}</strong>
                        <span className={`insurance-match-confidence ${suggestion.confidence}`}>{suggestion.confidence === "high" ? "Coincidencia alta" : suggestion.confidence === "medium" ? "Coincidencia media" : "Coincidencia baja"}</span>
                        <strong>{claimIdentity(suggestion.claim)}</strong>
                        <dl className="insurance-claim-choice-details">
                          <div><dt>N.º de expediente</dt><dd>{suggestion.claim.claimNumber}</dd></div>
                          <div><dt>Fecha</dt><dd>{formatShortDate(suggestion.claim.incidentDate)}</dd></div>
                          <div><dt>Conductor</dt><dd>{suggestion.claim.driver || "No registrado"}</dd></div>
                          <div><dt>Placa</dt><dd>{suggestion.claim.plate || "No registrada"}</dd></div>
                          <div><dt>Monto reclamado</dt><dd>{suggestion.claim.amount || "No registrado"}</dd></div>
                          <div><dt>Estado</dt><dd>{suggestion.claim.status}</dd></div>
                          <div><dt>Empresa</dt><dd>{companyByUnit.get(normalizeUnitKey(suggestion.claim.unit)) || "No registrada"}</dd></div>
                        </dl>
                        <ul>{suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                      </div>
                      <div className="insurance-claim-choice-actions">
                        <button type="button" className="button ghost small" onClick={() => onOpenClaim(suggestion.claim.id)}>Ver expediente</button>
                        {!readOnly && <button type="button" className="button primary small" disabled={saving} onClick={() => void linkPayment(suggestion.claim.id)}>Vincular este expediente</button>}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {!readOnly && <div className="insurance-bank-manual-match">
                <div className="insurance-bank-manual-match__fields">
                  <label>Buscar otro expediente
                    <input
                      type="search"
                      value={manualSearch}
                      placeholder="Expediente, monto, unidad, placa, conductor o aseguradora"
                      onChange={(event) => {
                        setManualSearch(event.target.value);
                        setManualClaimId("");
                      }}
                    />
                  </label>
                  <label>Elegir expediente
                    <select value={manualClaimId} onChange={(event) => setManualClaimId(event.target.value)}>
                      <option value="">{manualClaims.length > 0 ? `Seleccionar entre ${manualClaims.length}` : "Sin resultados"}</option>
                      {manualClaims.map((claim) => <option key={claim.id} value={claim.id}>{claimOptionLabel(claim)}</option>)}
                    </select>
                  </label>
                </div>
                {manualClaim && <div className="insurance-manual-claim-preview">
                  <strong>{claimIdentity(manualClaim)}</strong>
                  <span>Monto {manualClaim.amount} · {companyByUnit.get(normalizeUnitKey(manualClaim.unit)) || "Empresa no registrada"} · {manualClaim.driver || "Sin conductor"} · {manualClaim.plate || "Sin placa"} · {formatShortDate(manualClaim.incidentDate)}</span>
                </div>}
                <div className="insurance-claim-choice-actions">
                  <button type="button" className="button ghost" disabled={!manualClaim} onClick={() => manualClaim && onOpenClaim(manualClaim.id)}>Ver expediente</button>
                  <button type="button" className="button" disabled={!manualClaimId || saving} onClick={() => void linkPayment(manualClaimId)}>Vincular seleccionado</button>
                </div>
              </div>}
              {!readOnly && <button type="button" className="button ghost insurance-return-payment" disabled={saving} onClick={() => void returnToPayments()}>Devolver a Pagos</button>}
            </>}
          </aside>}
        </div>
      )}
    </section>
  );
}
