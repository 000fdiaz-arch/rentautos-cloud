import { useEffect, useMemo, useState } from "react";
import {
  loadInsuranceClaims,
  loadInsuranceInsurers,
  saveInsuranceClaim,
  saveInsuranceInsurer,
  type InsuranceClaimRecord
} from "../cloudData";
import type { Client } from "../types";
import { useControlUnitsRows } from "./controlUnits/useControlUnitsRows";

type Props = {
  clients: Client[];
  dataOwnerUserId?: string | null;
  readOnly?: boolean;
};

type ClaimForm = {
  incidentDate: string;
  unit: string;
  driver: string;
  plate: string;
  insurer: string;
  claimNumber: string;
  amount: string;
  vehicleDamage: string;
};

type ActiveTab = "form" | "list";

const EMPTY_FORM: ClaimForm = {
  incidentDate: "",
  unit: "",
  driver: "",
  plate: "",
  insurer: "",
  claimNumber: "",
  amount: "",
  vehicleDamage: ""
};

const MAX_DAMAGE_PHOTOS = 5;

function normalizeUnit(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeInsurer(value: string): string {
  return value.trim().toUpperCase();
}

export default function InsuranceWorkflowPage({ clients, dataOwnerUserId, readOnly = false }: Props) {
  const { rows: fleetUnits, loading: fleetLoading, loadError: fleetLoadError } = useControlUnitsRows(dataOwnerUserId);
  const [form, setForm] = useState<ClaimForm>(EMPTY_FORM);
  const [insurers, setInsurers] = useState<string[]>([]);
  const [claims, setClaims] = useState<InsuranceClaimRecord[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("form");
  const [damagePhotoNames, setDamagePhotoNames] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");
  const [loadingCloud, setLoadingCloud] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const activeClientsByUnit = useMemo(() => {
    return new Map(
      clients
        .filter((client) => client.status !== "archivado")
        .map((client) => [normalizeUnit(client.unitId), client])
    );
  }, [clients]);

  const clientsByUnit = useMemo(() => {
    return new Map(clients.map((client) => [normalizeUnit(client.unitId), client]));
  }, [clients]);

  const fleetUnitsByUnit = useMemo(() => {
    return new Map(fleetUnits.map((unit) => [normalizeUnit(unit.unit_id), unit]));
  }, [fleetUnits]);

  const unitOptions = useMemo(() => {
    const units = new Set<string>();
    fleetUnits.forEach((unit) => {
      const unitId = normalizeUnit(unit.unit_id);
      if (unitId) units.add(unitId);
    });
    clients.forEach((client) => {
      const unitId = normalizeUnit(client.unitId);
      if (unitId && client.status !== "archivado") units.add(unitId);
    });
    return Array.from(units).sort((left, right) => left.localeCompare(right, "es", { numeric: true }));
  }, [clients, fleetUnits]);

  const unitOptionLabels = useMemo(() => {
    return new Map(unitOptions.map((unitId) => {
      const fleetUnit = fleetUnitsByUnit.get(unitId);
      const client = activeClientsByUnit.get(unitId) ?? clientsByUnit.get(unitId);
      const parts = [client?.name ?? fleetUnit?.client_name, fleetUnit?.plate ? `Placa ${fleetUnit.plate}` : ""].filter(Boolean);
      return [unitId, parts.join(" - ")];
    }));
  }, [activeClientsByUnit, clientsByUnit, fleetUnitsByUnit, unitOptions]);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setInsurers([]);
      setClaims([]);
      setLoadingCloud(false);
      setLoadError("No se encontro owner de datos para cargar reclamos.");
      return;
    }

    let cancelled = false;
    setLoadingCloud(true);
    setLoadError("");
    Promise.all([
      loadInsuranceInsurers(dataOwnerUserId),
      loadInsuranceClaims(dataOwnerUserId)
    ])
      .then(([nextInsurers, nextClaims]) => {
        if (cancelled) return;
        setInsurers(nextInsurers);
        setClaims(nextClaims);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("No se pudieron cargar reclamos a seguros.", error);
        setLoadError("No se pudieron cargar los reclamos desde la nube.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCloud(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

  useEffect(() => {
    const unitId = normalizeUnit(form.unit);
    if (!unitId) return;
    const fleetUnit = fleetUnitsByUnit.get(unitId);
    const client = activeClientsByUnit.get(unitId) ?? clientsByUnit.get(unitId);
    const nextDriver = fleetUnit?.client_name ?? client?.name ?? "";
    const nextPlate = fleetUnit?.plate ?? "";
    if (form.driver === nextDriver && form.plate === nextPlate) return;
    setForm((current) => ({
      ...current,
      driver: nextDriver,
      plate: nextPlate
    }));
  }, [activeClientsByUnit, clientsByUnit, fleetUnitsByUnit, form.driver, form.plate, form.unit]);

  function patchForm(patch: Partial<ClaimForm>): void {
    setForm((current) => ({ ...current, ...patch }));
  }

  function handleUnitChange(value: string): void {
    const unitId = normalizeUnit(value);
    const fleetUnit = fleetUnitsByUnit.get(unitId);
    const client = activeClientsByUnit.get(unitId) ?? clientsByUnit.get(unitId);
    setForm((current) => ({
      ...current,
      unit: unitId,
      driver: fleetUnit?.client_name ?? client?.name ?? "",
      plate: fleetUnit?.plate ?? ""
    }));
  }

  function resetForm(): void {
    setForm(EMPTY_FORM);
    setDamagePhotoNames([]);
  }

  async function addInsurer(value: string): Promise<void> {
    if (!dataOwnerUserId || readOnly) return;
    const insurer = normalizeInsurer(value);
    if (!insurer) return;
    setSaving(true);
    setMessage("");
    try {
      await saveInsuranceInsurer(dataOwnerUserId, insurer);
      setInsurers((current) => Array.from(new Set([...current, insurer]))
        .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" })));
      patchForm({ insurer });
    } catch (error) {
      console.error("No se pudo guardar aseguradora.", error);
      setMessage("No se pudo guardar la aseguradora en la nube.");
    } finally {
      setSaving(false);
    }
  }

  function handleInsurerChange(value: string): void {
    if (value !== "__new__") {
      patchForm({ insurer: value });
      return;
    }
    if (readOnly) return;
    const insurer = window.prompt("Nombre de la nueva aseguradora");
    if (insurer) void addInsurer(insurer);
  }

  async function saveClaim(): Promise<void> {
    if (!dataOwnerUserId) {
      setMessage("No hay owner de datos para guardar reclamos en la nube.");
      return;
    }
    if (readOnly) {
      setMessage("Tu usuario solo puede ver esta pantalla.");
      return;
    }
    if (!form.incidentDate || !form.unit || !form.driver || !form.plate || !form.insurer) {
      setMessage("Completa fecha, unidad, nombre completo, placa y aseguradora antes de guardar.");
      return;
    }

    const now = new Date().toISOString();
    const nextClaim: InsuranceClaimRecord = {
      ...form,
      id: `insurance-claim-${Date.now()}`,
      status: "En seguimiento",
      damagePhotoNames,
      createdAt: now,
      updatedAt: now
    };

    setSaving(true);
    setMessage("");
    try {
      await saveInsuranceClaim(dataOwnerUserId, nextClaim);
      setClaims((current) => [nextClaim, ...current]);
      resetForm();
      setMessage("Reclamo guardado en seguimiento.");
      setActiveTab("list");
    } catch (error) {
      console.error("No se pudo guardar reclamo.", error);
      setMessage("No se pudo guardar el reclamo en la nube.");
    } finally {
      setSaving(false);
    }
  }

  function handleDamagePhotosChange(files: FileList | null): void {
    const names = Array.from(files ?? []).map((file) => file.name);
    if (names.length > MAX_DAMAGE_PHOTOS) {
      setMessage(`Maximo ${MAX_DAMAGE_PHOTOS} fotos por reclamo. Se guardaran las primeras ${MAX_DAMAGE_PHOTOS}.`);
    }
    setDamagePhotoNames(names.slice(0, MAX_DAMAGE_PHOTOS));
  }

  return (
    <section className="insurance-workflow-page">
      <div className="panel insurance-workflow-header">
        <div>
          <span className="workflow-eyebrow">Seguros</span>
          <h2>Reclamos a seguros</h2>
        </div>
      </div>

      <div className="panel workflow-tabs-panel">
        <button type="button" className={activeTab === "form" ? "active" : ""} onClick={() => setActiveTab("form")}>Formulario</button>
        <button type="button" className={activeTab === "list" ? "active" : ""} onClick={() => setActiveTab("list")}>Lista de reclamos</button>
      </div>

      {activeTab === "form" && (
        <form className="panel workflow-form-panel" onSubmit={(event) => { event.preventDefault(); void saveClaim(); }}>
          <div className="panel-head">
            <h2>Formulario de reclamo</h2>
            <button type="submit" className="button primary" disabled={readOnly || saving || loadingCloud}>Guardar</button>
          </div>
          {readOnly && <p className="hint workflow-message">Modo lectura: tu usuario no puede crear ni editar reclamos.</p>}
          {loadingCloud && <p className="hint workflow-message">Cargando reclamos...</p>}
          {loadError && <p className="hint workflow-message">{loadError}</p>}
          {fleetLoading && <p className="hint workflow-message">Cargando autos...</p>}
          {fleetLoadError && <p className="hint workflow-message">{fleetLoadError}</p>}
          {message && <p className="hint workflow-message">{message}</p>}

          <div className="workflow-form-grid">
            <label>
              Fecha del incidente
              <input
                type="date"
                name="incidentDate"
                value={form.incidentDate}
                onChange={(event) => patchForm({ incidentDate: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label>
              Unidad
              <input
                name="unit"
                list="insurance-unit-options"
                placeholder="Ej. B52"
                value={form.unit}
                onChange={(event) => handleUnitChange(event.target.value)}
                disabled={readOnly}
              />
              <datalist id="insurance-unit-options">
                {unitOptions.map((unitId) => <option key={unitId} value={unitId} label={unitOptionLabels.get(unitId) ?? ""} />)}
              </datalist>
            </label>

            <label>
              Nombre completo
              <input
                name="driver"
                placeholder="Nombre completo"
                value={form.driver}
                onChange={(event) => patchForm({ driver: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label>
              Placa
              <input
                name="plate"
                placeholder="Placa del auto"
                value={form.plate}
                onChange={(event) => patchForm({ plate: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label>
              Aseguradora
              <select
                name="insurer"
                value={form.insurer}
                onChange={(event) => handleInsurerChange(event.target.value)}
                disabled={readOnly}
              >
                <option value="">Seleccionar aseguradora</option>
                {insurers.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}
                <option value="__new__">+ Nueva aseguradora</option>
              </select>
            </label>

            <label>
              Numero de reclamo
              <input
                name="claimNumber"
                placeholder="Numero de reclamo"
                value={form.claimNumber}
                onChange={(event) => patchForm({ claimNumber: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label>
              Monto
              <input
                type="number"
                name="amount"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(event) => patchForm({ amount: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label className="workflow-form-notes">
              Daños del auto
              <textarea
                name="vehicleDamage"
                placeholder="Describe los daños del auto"
                value={form.vehicleDamage}
                onChange={(event) => patchForm({ vehicleDamage: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label className="workflow-form-notes">
              Fotos de los daños
              <input
                type="file"
                name="damagePhotos"
                accept="image/*"
                multiple
                onChange={(event) => handleDamagePhotosChange(event.target.files)}
                disabled={readOnly}
              />
              <span className="hint">{damagePhotoNames.length} de {MAX_DAMAGE_PHOTOS} fotos seleccionadas</span>
            </label>
          </div>
        </form>
      )}

      {activeTab === "list" && (
        <section className="panel workflow-claims-panel">
          <div className="panel-head">
            <h2>Lista de reclamos</h2>
            <span className="hint">{claims.length} reclamos</span>
          </div>
          {loadingCloud && <p className="hint workflow-message">Cargando reclamos...</p>}
          {loadError && <p className="hint workflow-message">{loadError}</p>}
          {message && <p className="hint workflow-message">{message}</p>}
          <div className="workflow-claims-list">
            {claims.length === 0 && !loadingCloud && <p className="hint">Todavia no hay reclamos guardados.</p>}
            {claims.map((claim) => (
              <article key={claim.id} className="workflow-claim-card">
                <div>
                  <strong>{claim.unit || "Sin unidad"} - {claim.driver || "Sin nombre"}</strong>
                  <span>{claim.insurer || "Sin aseguradora"} - {claim.claimNumber || "Sin numero"}</span>
                </div>
                <div>
                  <span className="workflow-status-pill">{claim.status}</span>
                  <small>{claim.incidentDate || "Sin fecha"}</small>
                </div>
                <dl>
                  <div><dt>Placa</dt><dd>{claim.plate || "-"}</dd></div>
                  <div><dt>Monto</dt><dd>{claim.amount || "-"}</dd></div>
                  <div><dt>Fotos</dt><dd>{claim.damagePhotoNames.length || "-"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
