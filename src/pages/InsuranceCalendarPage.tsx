import { useMemo, useState } from "react";

type CaseType = "colision" | "juicio" | "renovacion" | "reclamo" | "audiencia";
type CaseStatus = "urgente" | "pendiente" | "en_proceso" | "completado";

type InsuranceCase = {
  id: string;
  title: string;
  client: string;
  unit: string;
  plate: string;
  insurer: string;
  type: CaseType;
  status: CaseStatus;
  date: string;
  time: string;
  owner: string;
  amount: number;
  nextAction: string;
  notes: string;
};

const CASE_TYPE_LABELS: Record<CaseType, string> = {
  colision: "Colision",
  juicio: "Juicio",
  renovacion: "Renovacion",
  reclamo: "Reclamo",
  audiencia: "Audiencia"
};

const STATUS_LABELS: Record<CaseStatus, string> = {
  urgente: "Urgente",
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completado: "Completado"
};

const CASES: InsuranceCase[] = [
  {
    id: "SEG-1042",
    title: "Colision frontal - inspeccion pendiente",
    client: "Carlos Mendoza",
    unit: "A024",
    plate: "AF-3102",
    insurer: "ASSA",
    type: "colision",
    status: "urgente",
    date: "2026-07-23",
    time: "09:30",
    owner: "Rosa",
    amount: 1850,
    nextAction: "Enviar fotos finales y croquis al ajustador",
    notes: "Unidad en taller. Falta confirmar deducible y autorizacion."
  },
  {
    id: "SEG-1037",
    title: "Audiencia por accidente con tercero",
    client: "Luis De Leon",
    unit: "B078",
    plate: "BA-7731",
    insurer: "Ancon",
    type: "audiencia",
    status: "pendiente",
    date: "2026-07-24",
    time: "14:00",
    owner: "Legal",
    amount: 0,
    nextAction: "Confirmar asistencia del conductor y expediente fisico",
    notes: "Juzgado de transito. Llevar poliza, contrato y declaracion."
  },
  {
    id: "SEG-1028",
    title: "Renovacion de poliza flota grupo C",
    client: "Flota Rentautos",
    unit: "C001-C045",
    plate: "Multiple",
    insurer: "Internacional",
    type: "renovacion",
    status: "en_proceso",
    date: "2026-07-27",
    time: "10:00",
    owner: "Admin",
    amount: 12600,
    nextAction: "Validar listado de unidades activas antes de emitir",
    notes: "La aseguradora pidio millaje actualizado de 12 unidades."
  },
  {
    id: "SEG-1019",
    title: "Reclamo por perdida de faro derecho",
    client: "Marta Ruiz",
    unit: "D014",
    plate: "DD-4415",
    insurer: "Mapfre",
    type: "reclamo",
    status: "en_proceso",
    date: "2026-07-29",
    time: "11:15",
    owner: "Joel",
    amount: 420,
    nextAction: "Subir factura del repuesto al portal",
    notes: "Aprobacion preliminar recibida por correo."
  },
  {
    id: "SEG-1008",
    title: "Juicio civil - seguimiento de poder",
    client: "Roberto Perez",
    unit: "A066",
    plate: "AX-6021",
    insurer: "Sura",
    type: "juicio",
    status: "urgente",
    date: "2026-07-31",
    time: "08:00",
    owner: "Legal",
    amount: 3300,
    nextAction: "Recoger poder notariado y remitir al abogado",
    notes: "Vence plazo de presentacion esta semana."
  },
  {
    id: "SEG-1001",
    title: "Cierre de colision leve",
    client: "Ana Batista",
    unit: "T009",
    plate: "TX-0904",
    insurer: "ASSA",
    type: "colision",
    status: "completado",
    date: "2026-07-18",
    time: "16:30",
    owner: "Rosa",
    amount: 275,
    nextAction: "Archivar comprobantes",
    notes: "Pago recibido y unidad entregada."
  }
];

const FILTER_TYPES: Array<"todos" | CaseType> = ["todos", "colision", "juicio", "audiencia", "reclamo", "renovacion"];
const FILTER_STATUS: Array<"todos" | CaseStatus> = ["todos", "urgente", "pendiente", "en_proceso", "completado"];

const JULY_2026_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const LEADING_BLANKS = 3;

function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-PA", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function dayFromDate(value: string): number {
  return Number(value.slice(8, 10));
}

export default function InsuranceCalendarPage() {
  const [typeFilter, setTypeFilter] = useState<"todos" | CaseType>("todos");
  const [statusFilter, setStatusFilter] = useState<"todos" | CaseStatus>("todos");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(CASES[0]?.id ?? "");

  const filteredCases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return CASES.filter((item) => {
      const matchesType = typeFilter === "todos" || item.type === typeFilter;
      const matchesStatus = statusFilter === "todos" || item.status === statusFilter;
      const haystack = `${item.id} ${item.title} ${item.client} ${item.unit} ${item.plate} ${item.insurer}`.toLowerCase();
      return matchesType && matchesStatus && (!needle || haystack.includes(needle));
    });
  }, [search, statusFilter, typeFilter]);

  const selectedCase = filteredCases.find((item) => item.id === selectedId) ?? filteredCases[0] ?? CASES[0];
  const casesByDay = useMemo(() => {
    return filteredCases.reduce<Record<number, InsuranceCase[]>>((acc, item) => {
      const day = dayFromDate(item.date);
      acc[day] = [...(acc[day] ?? []), item];
      return acc;
    }, {});
  }, [filteredCases]);

  const urgentCount = CASES.filter((item) => item.status === "urgente").length;
  const pendingWeekCount = CASES.filter((item) => dayFromDate(item.date) >= 23 && dayFromDate(item.date) <= 31 && item.status !== "completado").length;
  const exposureAmount = CASES.filter((item) => item.status !== "completado").reduce((total, item) => total + item.amount, 0);

  return (
    <section className="insurance-page">
      <div className="hero insurance-hero">
        <div>
          <h1>Calendario de seguros</h1>
          <p>Control de colisiones, juicios, reclamos, audiencias y renovaciones por fecha critica.</p>
        </div>
        <button type="button" className="button primary">Nuevo caso</button>
      </div>

      <div className="insurance-summary">
        <article>
          <span>Casos urgentes</span>
          <strong>{urgentCount}</strong>
        </article>
        <article>
          <span>Vencen esta semana</span>
          <strong>{pendingWeekCount}</strong>
        </article>
        <article>
          <span>Exposicion abierta</span>
          <strong>{formatMoney(exposureAmount)}</strong>
        </article>
        <article>
          <span>Aseguradoras activas</span>
          <strong>5</strong>
        </article>
      </div>

      <section className="panel insurance-filters">
        <label>
          Buscar expediente
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cliente, placa, unidad o caso" />
        </label>
        <label>
          Tipo
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "todos" | CaseType)}>
            {FILTER_TYPES.map((value) => (
              <option key={value} value={value}>{value === "todos" ? "Todos" : CASE_TYPE_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "todos" | CaseStatus)}>
            {FILTER_STATUS.map((value) => (
              <option key={value} value={value}>{value === "todos" ? "Todos" : STATUS_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <button type="button" className="button ghost">Exportar agenda</button>
      </section>

      <div className="insurance-workspace">
        <section className="panel insurance-calendar-panel">
          <div className="panel-head">
            <div>
              <h2>Julio 2026</h2>
              <p className="hint">Vista mensual de fechas limite y compromisos.</p>
            </div>
            <div className="insurance-calendar-actions">
              <button type="button" className="button ghost small">Hoy</button>
              <button type="button" className="button ghost small">Semana</button>
            </div>
          </div>

          <div className="insurance-weekdays">
            {["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="insurance-calendar-grid">
            {Array.from({ length: LEADING_BLANKS }, (_, index) => <div key={`blank-${index}`} className="insurance-day insurance-day--blank" />)}
            {JULY_2026_DAYS.map((day) => {
              const dayCases = casesByDay[day] ?? [];
              const hasUrgent = dayCases.some((item) => item.status === "urgente");
              return (
                <button
                  key={day}
                  type="button"
                  className={`insurance-day ${day === 23 ? "insurance-day--today" : ""} ${hasUrgent ? "insurance-day--urgent" : ""}`}
                  onClick={() => dayCases[0] && setSelectedId(dayCases[0].id)}
                >
                  <span>{day}</span>
                  {dayCases.map((item) => (
                    <small key={item.id}>{CASE_TYPE_LABELS[item.type]} · {item.unit}</small>
                  ))}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="panel insurance-detail">
          <div className="panel-head">
            <div>
              <h2>{selectedCase.id}</h2>
              <p className="hint">{selectedCase.title}</p>
            </div>
            <span className={`insurance-status insurance-status--${selectedCase.status}`}>{STATUS_LABELS[selectedCase.status]}</span>
          </div>

          <dl className="insurance-detail-list">
            <div><dt>Cliente</dt><dd>{selectedCase.client}</dd></div>
            <div><dt>Unidad</dt><dd>{selectedCase.unit} · {selectedCase.plate}</dd></div>
            <div><dt>Aseguradora</dt><dd>{selectedCase.insurer}</dd></div>
            <div><dt>Fecha critica</dt><dd>{selectedCase.date} · {selectedCase.time}</dd></div>
            <div><dt>Responsable</dt><dd>{selectedCase.owner}</dd></div>
            <div><dt>Monto estimado</dt><dd>{formatMoney(selectedCase.amount)}</dd></div>
          </dl>

          <div className="insurance-next-action">
            <span>Proxima accion</span>
            <strong>{selectedCase.nextAction}</strong>
            <p>{selectedCase.notes}</p>
          </div>
        </aside>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Agenda priorizada</h2>
          <span className="hint">{filteredCases.length} casos visibles</span>
        </div>
        <div className="insurance-case-list">
          {filteredCases.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`insurance-case-row ${selectedCase.id === item.id ? "insurance-case-row--active" : ""}`}
              onClick={() => setSelectedId(item.id)}
            >
              <span className={`insurance-dot insurance-dot--${item.status}`} />
              <span>
                <strong>{item.id}</strong>
                <small>{item.client} · {item.unit} · {item.plate}</small>
              </span>
              <span>{CASE_TYPE_LABELS[item.type]}</span>
              <span>{item.date} {item.time}</span>
              <span>{item.owner}</span>
              <span className={`insurance-status insurance-status--${item.status}`}>{STATUS_LABELS[item.status]}</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
