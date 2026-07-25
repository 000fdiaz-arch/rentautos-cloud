import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "../format";

type ClaimStatus = "pendiente" | "juicio" | "absuelto" | "perdio" | "pagado" | "taller" | "declinado";
type ClaimView = "expedientes" | "agenda" | "taller";

type InsuranceClaim = {
  id: string;
  collisionDate: string;
  unit: string;
  driver: string;
  plate: string;
  vehicle: string;
  insurer: string;
  hearingDate?: string;
  claimNumber?: string;
  status: ClaimStatus;
  place?: string;
  court?: string;
  amount?: number;
  paid: boolean;
  workshopStage?: "chapisteria" | "mecanica" | "rotulado" | "listo";
  observations?: string;
  followUp?: string;
};

const STATUS_LABELS: Record<ClaimStatus, string> = {
  pendiente: "Pendiente",
  juicio: "Juicio",
  absuelto: "Absuelto",
  perdio: "Perdio",
  pagado: "Pagado",
  taller: "Taller",
  declinado: "Declinado"
};

const STATUS_OPTIONS: Array<{ value: ClaimStatus | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "pendiente", label: "Pendientes" },
  { value: "juicio", label: "En juicio" },
  { value: "absuelto", label: "Absuelto" },
  { value: "perdio", label: "Perdio" },
  { value: "pagado", label: "Pagado" },
  { value: "taller", label: "Taller" },
  { value: "declinado", label: "Declinado" }
];

const CLAIMS: InsuranceClaim[] = [
  {
    id: "C45-92679",
    collisionDate: "2025-09-28",
    unit: "C45",
    driver: "DOMINGO GARCIA",
    plate: "EA4379",
    vehicle: "KIA RIO",
    insurer: "JUICIO",
    hearingDate: "2025-11-25",
    claimNumber: "92679",
    status: "absuelto",
    place: "SAN MIGUELITO",
    paid: false,
    observations: "Buscar resolucion",
    followUp: "A espera de resolucion"
  },
  {
    id: "B78-80408",
    collisionDate: "2025-07-18",
    unit: "B78",
    driver: "CRISTOBAL SAMANIEGO",
    plate: "EG5352",
    vehicle: "KIA RIO",
    insurer: "JUICIO",
    hearingDate: "2025-08-25",
    claimNumber: "80408",
    status: "absuelto",
    place: "JUAN DIAZ",
    court: "2",
    paid: false,
    observations: "El otro conductor no mantenia poliza vigente"
  },
  {
    id: "A101-1880",
    collisionDate: "2025-06-08",
    unit: "A101",
    driver: "ARLEN BORJAS",
    plate: "CU2663",
    vehicle: "CHEVROLET",
    insurer: "FEDPA",
    claimNumber: "2025-6-241880",
    status: "declinado",
    paid: false,
    observations: "Declinado por aseguradora"
  },
  {
    id: "A59-hearing",
    collisionDate: "2025-06-15",
    unit: "A59",
    driver: "MICHAEL GARCIA",
    plate: "CG4402",
    vehicle: "KIA RIO",
    insurer: "CONDUCTOR",
    hearingDate: "2026-07-11",
    status: "juicio",
    paid: false,
    observations: "Responsabilidad por confirmar"
  },
  {
    id: "B76-17116",
    collisionDate: "2026-01-13",
    unit: "B76",
    driver: "BRIAN",
    plate: "EG5334",
    vehicle: "KIA RIO",
    insurer: "JUICIO",
    hearingDate: "2026-05-11",
    claimNumber: "17116",
    status: "absuelto",
    place: "ARRAIJAN",
    paid: false
  },
  {
    id: "A83-sura",
    collisionDate: "2025-08-13",
    unit: "A83",
    driver: "YOMIRA QUINTERO",
    plate: "EF1112",
    vehicle: "KIA RIO",
    insurer: "SURA",
    hearingDate: "2025-09-12",
    status: "pendiente",
    paid: true,
    observations: "Sin informacion, no se presento"
  },
  {
    id: "B80-83364",
    collisionDate: "2026-02-04",
    unit: "B80",
    driver: "NESTOR MUNOZ",
    plate: "CM6045",
    vehicle: "KIA RIO",
    insurer: "JUICIO",
    hearingDate: "2026-03-13",
    claimNumber: "83364",
    status: "absuelto",
    place: "JUAN DIAZ",
    paid: false
  },
  {
    id: "A75-shop",
    collisionDate: "2024-10-26",
    unit: "A75",
    driver: "",
    plate: "",
    vehicle: "",
    insurer: "SURA",
    claimNumber: "4502264",
    status: "taller",
    amount: 231.67,
    paid: false,
    workshopStage: "rotulado",
    observations: "Pendiente"
  },
  {
    id: "A56-mapfre",
    collisionDate: "2025-05-09",
    unit: "A56",
    driver: "",
    plate: "",
    vehicle: "",
    insurer: "MAPFRE",
    claimNumber: "126-2025",
    hearingDate: "2026-01-20",
    status: "taller",
    paid: false,
    workshopStage: "mecanica"
  },
  {
    id: "A41-fedpa",
    collisionDate: "2025-02-17",
    unit: "A41",
    driver: "",
    plate: "",
    vehicle: "",
    insurer: "FEDPA",
    claimNumber: "2025-3-2227266",
    hearingDate: "2026-12-26",
    status: "taller",
    paid: false,
    workshopStage: "chapisteria"
  }
];

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateText(value?: string): string {
  const date = parseDate(value);
  return date ? formatDate(date) : "-";
}

function daysUntil(value?: string): number | null {
  const target = parseDate(value);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function getUrgencyLabel(claim: InsuranceClaim): string {
  const days = daysUntil(claim.hearingDate);
  if (days === null) return "Sin fecha";
  if (days < 0) return "Vencido";
  if (days === 0) return "Hoy";
  if (days <= 7) return `${days} dias`;
  return formatDateText(claim.hearingDate);
}

export default function InsuranceClaimsPage() {
  const [view, setView] = useState<ClaimView>("expedientes");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | "all">("all");
  const [insurerFilter, setInsurerFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string>(CLAIMS[0]?.id ?? "");

  const insurers = useMemo(() => {
    return Array.from(new Set(CLAIMS.map((claim) => claim.insurer).filter(Boolean))).sort();
  }, []);

  const filteredClaims = useMemo(() => {
    const query = normalize(search);
    return CLAIMS.filter((claim) => {
      const matchesStatus = statusFilter === "all" || claim.status === statusFilter;
      const matchesInsurer = insurerFilter === "all" || claim.insurer === insurerFilter;
      const haystack = [
        claim.unit,
        claim.driver,
        claim.plate,
        claim.vehicle,
        claim.insurer,
        claim.claimNumber,
        claim.observations,
        claim.followUp
      ].map(normalize).join(" ");
      return matchesStatus && matchesInsurer && (!query || haystack.includes(query));
    });
  }, [insurerFilter, search, statusFilter]);

  const agendaClaims = useMemo(() => {
    return filteredClaims
      .filter((claim) => claim.hearingDate)
      .slice()
      .sort((a, b) => String(a.hearingDate).localeCompare(String(b.hearingDate)));
  }, [filteredClaims]);

  const workshopClaims = useMemo(() => {
    return filteredClaims.filter((claim) => claim.status === "taller" || claim.workshopStage);
  }, [filteredClaims]);

  const selectedClaim = useMemo(() => {
    return CLAIMS.find((claim) => claim.id === selectedId) ?? filteredClaims[0] ?? CLAIMS[0];
  }, [filteredClaims, selectedId]);

  const pendingCount = CLAIMS.filter((claim) => ["pendiente", "juicio", "taller"].includes(claim.status)).length;
  const hearingCount = CLAIMS.filter((claim) => claim.hearingDate && claim.status !== "pagado").length;
  const unpaidCount = CLAIMS.filter((claim) => !claim.paid).length;
  const paidAmount = CLAIMS.reduce((total, claim) => total + (claim.paid ? claim.amount ?? 0 : 0), 0);

  return (
    <section className="claims-page">
      <div className="panel claims-hero">
        <div>
          <span className="section-eyebrow">Seguros</span>
          <h2>Reclamos de seguros</h2>
          <p className="hint">Seguimiento de colisiones, juicios, pagos y taller inspirado en el cuadro operativo.</p>
        </div>
      </div>

      <div className="claims-kpis">
        <article>
          <span>Expedientes</span>
          <strong>{CLAIMS.length}</strong>
        </article>
        <article>
          <span>Abiertos</span>
          <strong>{pendingCount}</strong>
        </article>
        <article>
          <span>Con audiencia</span>
          <strong>{hearingCount}</strong>
        </article>
        <article>
          <span>No pagados</span>
          <strong>{unpaidCount}</strong>
        </article>
        <article>
          <span>Pagado registrado</span>
          <strong>{formatCurrency(paidAmount)}</strong>
        </article>
      </div>

      <section className="panel claims-filters">
        <label>
          Buscar
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Unidad, placa, conductor, reclamo..."
          />
        </label>
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ClaimStatus | "all")}>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Aseguradora
          <select value={insurerFilter} onChange={(event) => setInsurerFilter(event.target.value)}>
            <option value="all">Todas</option>
            {insurers.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}
          </select>
        </label>
        <div className="claims-tabs" role="tablist" aria-label="Vista de reclamos">
          <button type="button" className={view === "expedientes" ? "active" : ""} onClick={() => setView("expedientes")}>Expedientes</button>
          <button type="button" className={view === "agenda" ? "active" : ""} onClick={() => setView("agenda")}>Agenda</button>
          <button type="button" className={view === "taller" ? "active" : ""} onClick={() => setView("taller")}>Taller</button>
        </div>
      </section>

      <div className="claims-workspace">
        <section className="panel claims-main-panel">
          {view === "expedientes" && (
            <div className="claims-table-wrap">
              <table className="claims-table">
                <thead>
                  <tr>
                    <th>Unidad</th>
                    <th>Colision</th>
                    <th>Conductor</th>
                    <th>Aseguradora</th>
                    <th>Juicio</th>
                    <th>Estado</th>
                    <th>Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.map((claim) => (
                    <tr key={claim.id} className={selectedClaim.id === claim.id ? "active" : ""} onClick={() => setSelectedId(claim.id)}>
                      <td><strong>{claim.unit}</strong><small>{claim.plate || claim.vehicle || "-"}</small></td>
                      <td>{formatDateText(claim.collisionDate)}</td>
                      <td>{claim.driver || "-"}</td>
                      <td>{claim.insurer}</td>
                      <td>{getUrgencyLabel(claim)}</td>
                      <td><span className={`claim-status claim-status--${claim.status}`}>{STATUS_LABELS[claim.status]}</span></td>
                      <td>{claim.paid ? "Si" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === "agenda" && (
            <div className="claims-agenda">
              {agendaClaims.map((claim) => (
                <button key={claim.id} type="button" className={selectedClaim.id === claim.id ? "active" : ""} onClick={() => setSelectedId(claim.id)}>
                  <span>{formatDateText(claim.hearingDate)}</span>
                  <strong>{claim.unit} · {claim.place || "Sin lugar"}</strong>
                  <small>{claim.driver || claim.claimNumber || "Sin conductor registrado"}</small>
                  <em>{getUrgencyLabel(claim)}</em>
                </button>
              ))}
            </div>
          )}

          {view === "taller" && (
            <div className="claims-shop-grid">
              {workshopClaims.map((claim) => (
                <button key={claim.id} type="button" className={selectedClaim.id === claim.id ? "active" : ""} onClick={() => setSelectedId(claim.id)}>
                  <span>{claim.unit}</span>
                  <strong>{claim.workshopStage ? claim.workshopStage.toUpperCase() : "SEGUIMIENTO"}</strong>
                  <small>{claim.insurer} {claim.claimNumber ? `· ${claim.claimNumber}` : ""}</small>
                  <p>{claim.observations || "Sin observaciones"}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="panel claims-detail">
          <div className="panel-head">
            <div>
              <span className="section-eyebrow">Detalle</span>
              <h3>{selectedClaim.unit} {selectedClaim.plate ? `· ${selectedClaim.plate}` : ""}</h3>
            </div>
            <span className={`claim-status claim-status--${selectedClaim.status}`}>{STATUS_LABELS[selectedClaim.status]}</span>
          </div>
          <dl className="claims-detail-list">
            <div><dt>Conductor</dt><dd>{selectedClaim.driver || "-"}</dd></div>
            <div><dt>Vehiculo</dt><dd>{selectedClaim.vehicle || "-"}</dd></div>
            <div><dt>Aseguradora</dt><dd>{selectedClaim.insurer}</dd></div>
            <div><dt>Reclamo</dt><dd>{selectedClaim.claimNumber || "-"}</dd></div>
            <div><dt>Colision</dt><dd>{formatDateText(selectedClaim.collisionDate)}</dd></div>
            <div><dt>Juicio</dt><dd>{formatDateText(selectedClaim.hearingDate)}</dd></div>
            <div><dt>Lugar</dt><dd>{selectedClaim.place || "-"}</dd></div>
            <div><dt>Monto</dt><dd>{selectedClaim.amount ? formatCurrency(selectedClaim.amount) : "-"}</dd></div>
            <div><dt>Pagado</dt><dd>{selectedClaim.paid ? "Si" : "No"}</dd></div>
          </dl>
          <div className="claims-note">
            <span>Observaciones</span>
            <p>{selectedClaim.observations || "Sin observaciones registradas."}</p>
          </div>
          <div className="claims-note">
            <span>Seguimiento</span>
            <p>{selectedClaim.followUp || "Sin seguimiento registrado."}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
