import { useEffect, useMemo, useState } from "react";
import type { Client } from "../types";
import { useControlUnitsRows } from "./controlUnits/useControlUnitsRows";

type Props = {
  clients: Client[];
  dataOwnerUserId?: string | null;
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

type ClaimRecord = ClaimForm & {
  id: string;
  status: "En seguimiento";
  damagePhotoNames: string[];
  createdAt: string;
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

const INSURERS_STORAGE_KEY = "cobrapp.insurance.insurers.v1";
const CLAIMS_STORAGE_KEY = "cobrapp.insurance.claims.v1";
const MAX_DAMAGE_PHOTOS = 5;

function readInsurers(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(INSURERS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }));
  } catch {
    return [];
  }
}

function writeInsurers(values: string[]): void {
  localStorage.setItem(INSURERS_STORAGE_KEY, JSON.stringify(values));
}

function readClaims(): ClaimRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLAIMS_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as ClaimRecord[] : [];
  } catch {
    return [];
  }
}

function writeClaims(values: ClaimRecord[]): void {
  localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(values));
}

function normalizeUnit(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeInsurer(value: string): string {
  return value.trim().toUpperCase();
}

export default function InsuranceWorkflowPage({ clients, dataOwnerUserId }: Props) {
  const { rows: fleetUnits, loading: fleetLoading, loadError: fleetLoadError } = useControlUnitsRows(dataOwnerUserId);
  const [form, setForm] = useState<ClaimForm>(EMPTY_FORM);
  const [insurers, setInsurers] = useState<string[]>(() => readInsurers());
  const [claims, setClaims] = useState<ClaimRecord[]>(() => readClaims());
  const [activeTab, setActiveTab] = useState<ActiveTab>("form");
  const [damagePhotoNames, setDamagePhotoNames] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("");

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

  function addInsurer(value: string): void {
    const insurer = normalizeInsurer(value);
    if (!insurer) return;
    const nextInsurers = Array.from(new Set([...insurers, insurer]))
      .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }));
    setInsurers(nextInsurers);
    writeInsurers(nextInsurers);
    patchForm({ insurer });
  }

  function handleInsurerChange(value: string): void {
    if (value !== "__new__") {
      patchForm({ insurer: value });
      return;
    }
    const insurer = window.prompt("Nombre de la nueva aseguradora");
    if (insurer) addInsurer(insurer);
  }

  function saveClaim(): void {
    if (!form.incidentDate || !form.unit || !form.driver || !form.plate || !form.insurer) {
      setMessage("Completa fecha, unidad, nombre completo, placa y aseguradora antes de guardar.");
      return;
    }

    const now = new Date().toISOString();
    const nextClaim: ClaimRecord = {
      ...form,
      id: `insurance-claim-${Date.now()}`,
      status: "En seguimiento",
      damagePhotoNames,
      createdAt: now
    };
    const nextClaims = [nextClaim, ...claims];
    setClaims(nextClaims);
    writeClaims(nextClaims);
    resetForm();
    setMessage("Reclamo guardado en seguimiento.");
    setActiveTab("list");
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
        <form className="panel workflow-form-panel" onSubmit={(event) => { event.preventDefault(); saveClaim(); }}>
          <div className="panel-head">
            <h2>Formulario de reclamo</h2>
            <button type="submit" className="button primary">Guardar</button>
          </div>
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
              />
            </label>

            <label>
              Placa
              <input
                name="plate"
                placeholder="Placa del auto"
                value={form.plate}
                onChange={(event) => patchForm({ plate: event.target.value })}
              />
            </label>

            <label>
              Aseguradora
              <select
                name="insurer"
                value={form.insurer}
                onChange={(event) => handleInsurerChange(event.target.value)}
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
              />
            </label>

            <label className="workflow-form-notes">
              Daños del auto
              <textarea
                name="vehicleDamage"
                placeholder="Describe los daños del auto"
                value={form.vehicleDamage}
                onChange={(event) => patchForm({ vehicleDamage: event.target.value })}
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
          {message && <p className="hint workflow-message">{message}</p>}
          <div className="workflow-claims-list">
            {claims.length === 0 && <p className="hint">Todavia no hay reclamos guardados.</p>}
            {claims.map((claim) => (
              <article key={claim.id} className="workflow-claim-card">
                <div>
                  <strong>{claim.unit || "Sin unidad"} - {claim.driver || "Sin nombre"}</strong>
                  <span>{claim.insurer || "Sin aseguradora"} · {claim.claimNumber || "Sin numero"}</span>
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
