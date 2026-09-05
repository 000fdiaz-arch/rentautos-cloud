import { useEffect, useState } from "react";
import type { Client, Payment } from "../types";
import CollisionsPage from "./CollisionsPage";
import IncidentIntakeForm, { type IncidentDestination } from "./IncidentIntakeForm";
import InsuranceWorkflowPage from "./InsuranceWorkflowPage";
import UnifiedIncidentsFollowUp from "./UnifiedIncidentsFollowUp";

type Props = {
  clients: Client[];
  payments: Payment[];
  dataOwnerUserId?: string | null;
  canViewIncidents: boolean;
  canEditIncidents: boolean;
  onClientsChange: (next: Client[]) => void | Promise<void>;
  onAlertCountChange?: (count: number) => void;
};

type ManagementTarget = { destination: IncidentDestination; id: string; search: string; section?: "follow_up" };

export default function IncidentsControlPage({
  clients,
  payments,
  dataOwnerUserId,
  canViewIncidents,
  canEditIncidents,
  onClientsChange,
  onAlertCountChange
}: Props) {
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [managementTarget, setManagementTarget] = useState<ManagementTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pageMessage, setPageMessage] = useState("");

  function handleIncidentSaved(destination: IncidentDestination): void {
    setRefreshKey((current) => current + 1);
    setRegistrationOpen(false);
    setPageMessage(destination === "judicial"
      ? "Siniestro guardado. Siguiente paso: abre el expediente judicial y revisa la acción indicada en “Lo que debes hacer ahora”."
      : "Siniestro guardado. Siguiente paso: abre el reclamo y revisa la acción pendiente indicada por el sistema.");
  }

  function closeManagement(): void {
    setManagementTarget(null);
    setRefreshKey((current) => current + 1);
    const url = new URL(window.location.href);
    if (url.searchParams.has("insuranceClaim") || url.searchParams.has("judicialCase")) {
      url.searchParams.delete("insuranceClaim");
      url.searchParams.delete("judicialCase");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const claimId = params.get("insuranceClaim")?.trim();
    const judicialCaseId = params.get("judicialCase")?.trim();
    if (claimId && canViewIncidents) setManagementTarget({ destination: "insurance", id: claimId, search: "" });
    else if (judicialCaseId && canViewIncidents) setManagementTarget({ destination: "judicial", id: judicialCaseId, search: "" });
  }, [canViewIncidents]);

  useEffect(() => {
    if (!managementTarget) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeManagement(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [managementTarget]);

  useEffect(() => {
    if (!registrationOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setRegistrationOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [registrationOpen]);

  return (
    <section className="incidents-workflow-page incidents-control-page">
      <header className="panel incidents-control-header">
        <div>
          <span className="workflow-eyebrow">Colisiones, juicios y seguros</span>
          <h1>Control de siniestros</h1>
          <p className="hint">Registra una colisión, define si continúa por juicio o reclamo al seguro y da seguimiento al expediente.</p>
        </div>
        <button type="button" className="button primary" onClick={() => setRegistrationOpen(true)}>+ Registrar colisión</button>
      </header>
      {pageMessage && <div className="workflow-message incident-save-confirmation" role="status"><span>{pageMessage}</span><button type="button" className="button ghost small" onClick={() => setPageMessage("")}>Cerrar</button></div>}

      <UnifiedIncidentsFollowUp
        dataOwnerUserId={dataOwnerUserId}
        canViewJudicial={canViewIncidents}
        canViewInsurance={canViewIncidents}
        canEditIncidents={canEditIncidents}
        refreshKey={refreshKey}
        onAlertCountChange={onAlertCountChange}
        onOpen={(destination, target) => setManagementTarget({ destination, ...target })}
      />

      {registrationOpen && (
        <div className="incident-claim-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRegistrationOpen(false); }}>
          <section className="incident-claim-modal incident-registration-modal" role="dialog" aria-modal="true" aria-labelledby="incident-registration-modal-title">
            <div className="incident-claim-modal-head">
              <div><span className="workflow-eyebrow">Nueva colisión</span><h2 id="incident-registration-modal-title">Registrar colisión</h2></div>
              <button type="button" className="button" aria-label="Cerrar registro de colisión" autoFocus onClick={() => setRegistrationOpen(false)}>Cerrar</button>
            </div>
            <IncidentIntakeForm
              clients={clients}
              dataOwnerUserId={dataOwnerUserId}
              canViewJudicial={canViewIncidents}
              canEditJudicial={canEditIncidents}
              canViewInsurance={canViewIncidents}
              canEditInsurance={canEditIncidents}
              embedded
              onSaved={handleIncidentSaved}
            />
          </section>
        </div>
      )}

      {managementTarget && canViewIncidents && (
        <div className="incident-claim-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeManagement(); }}>
          <section className={`incident-claim-modal incident-management-modal--${managementTarget.destination}`} role="dialog" aria-modal="true" aria-labelledby="incident-management-modal-title">
            <div className="incident-claim-modal-head">
              <div><span className="workflow-eyebrow">Gestión del expediente</span><h2 id="incident-management-modal-title">{managementTarget.destination === "judicial" ? "Juicio" : "Reclamo al seguro"}</h2></div>
              <button type="button" className="button" aria-label="Cerrar gestión del expediente" autoFocus onClick={closeManagement}>Cerrar</button>
            </div>
            {managementTarget.destination === "judicial" ? (
              <CollisionsPage
                key={`judicial-${managementTarget.id}`}
                clients={clients}
                payments={payments}
                dataOwnerUserId={dataOwnerUserId}
                readOnly={!canEditIncidents}
                onClientsChange={onClientsChange}
                embedded
                syncInsuranceClaims={canEditIncidents}
                hideCreateForm
                initialExpandedId={managementTarget.id}
                focusedCaseId={managementTarget.id}
                initialCaseTab={managementTarget.section}
              />
            ) : (
              <InsuranceWorkflowPage
                key={`insurance-${managementTarget.id}`}
                clients={clients}
                dataOwnerUserId={dataOwnerUserId}
                readOnly={!canEditIncidents}
                embedded
                hideCreateForm
                initialExpandedId={managementTarget.id}
                focusedClaimId={managementTarget.id}
                initialDetailTab={managementTarget.section}
              />
            )}
          </section>
        </div>
      )}
    </section>
  );
}
