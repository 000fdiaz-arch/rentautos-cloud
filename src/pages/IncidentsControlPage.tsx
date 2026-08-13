import { useEffect, useState } from "react";
import type { Client } from "../types";
import CollisionsPage from "./CollisionsPage";
import IncidentIntakeForm, { type IncidentDestination } from "./IncidentIntakeForm";
import InsuranceWorkflowPage from "./InsuranceWorkflowPage";
import UnifiedIncidentsFollowUp from "./UnifiedIncidentsFollowUp";

type Props = {
  clients: Client[];
  dataOwnerUserId?: string | null;
  canViewCollisions: boolean;
  canEditCollisions: boolean;
  canViewInsuranceWorkflow: boolean;
  canEditInsuranceWorkflow: boolean;
  onClientsChange: (next: Client[]) => void | Promise<void>;
  onAlertCountChange?: (count: number) => void;
};

type ManagementTarget = { destination: IncidentDestination; id: string; search: string };

export default function IncidentsControlPage({
  clients,
  dataOwnerUserId,
  canViewCollisions,
  canEditCollisions,
  canViewInsuranceWorkflow,
  canEditInsuranceWorkflow,
  onClientsChange,
  onAlertCountChange
}: Props) {
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [managementTarget, setManagementTarget] = useState<ManagementTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleIncidentSaved(): void {
    setRefreshKey((current) => current + 1);
    setRegistrationOpen(false);
  }

  function closeManagement(): void {
    setManagementTarget(null);
    setRefreshKey((current) => current + 1);
  }

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

      <UnifiedIncidentsFollowUp
        dataOwnerUserId={dataOwnerUserId}
        canViewJudicial={canViewCollisions}
        canViewInsurance={canViewInsuranceWorkflow}
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
              canViewJudicial={canViewCollisions}
              canEditJudicial={canEditCollisions}
              canViewInsurance={canViewInsuranceWorkflow}
              canEditInsurance={canEditInsuranceWorkflow}
              embedded
              onSaved={handleIncidentSaved}
            />
          </section>
        </div>
      )}

      {managementTarget && ((managementTarget.destination === "judicial" && canViewCollisions) || (managementTarget.destination === "insurance" && canViewInsuranceWorkflow)) && (
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
                dataOwnerUserId={dataOwnerUserId}
                readOnly={!canEditCollisions}
                onClientsChange={onClientsChange}
                embedded
                syncInsuranceClaims={canEditInsuranceWorkflow}
                hideCreateForm
                initialExpandedId={managementTarget.id}
                focusedCaseId={managementTarget.id}
              />
            ) : (
              <InsuranceWorkflowPage
                key={`insurance-${managementTarget.id}`}
                clients={clients}
                dataOwnerUserId={dataOwnerUserId}
                readOnly={!canEditInsuranceWorkflow}
                embedded
                hideCreateForm
                initialExpandedId={managementTarget.id}
                focusedClaimId={managementTarget.id}
              />
            )}
          </section>
        </div>
      )}
    </section>
  );
}
