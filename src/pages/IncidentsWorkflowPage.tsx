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

export default function IncidentsWorkflowPage({
  clients,
  dataOwnerUserId,
  canViewCollisions,
  canEditCollisions,
  canViewInsuranceWorkflow,
  canEditInsuranceWorkflow,
  onClientsChange,
  onAlertCountChange
}: Props) {
  const [managementTarget, setManagementTarget] = useState<ManagementTarget | null>(null);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);

  function handleIncidentSaved(): void {
    setFollowUpRefreshKey((current) => current + 1);
    setManagementTarget(null);
  }

  function closeManagement(): void {
    setManagementTarget(null);
    setFollowUpRefreshKey((current) => current + 1);
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

  return (
    <section className="incidents-workflow-page">
      <div className="panel insurance-workflow-header incidents-workflow-header">
        <div>
          <span className="workflow-eyebrow">Expedientes de choques, juicios y seguros</span>
          <h2>Gestión de siniestros</h2>
          <p className="hint">Administra el proceso judicial y el reclamo al seguro desde un solo lugar.</p>
        </div>
      </div>

      <IncidentIntakeForm
        clients={clients}
        dataOwnerUserId={dataOwnerUserId}
        canViewJudicial={canViewCollisions}
        canEditJudicial={canEditCollisions}
        canViewInsurance={canViewInsuranceWorkflow}
        canEditInsurance={canEditInsuranceWorkflow}
        onSaved={handleIncidentSaved}
      />

      <UnifiedIncidentsFollowUp
        dataOwnerUserId={dataOwnerUserId}
        canViewJudicial={canViewCollisions}
        canViewInsurance={canViewInsuranceWorkflow}
        refreshKey={followUpRefreshKey}
        onAlertCountChange={onAlertCountChange}
        onOpen={(destination, target) => setManagementTarget({ destination, ...target })}
      />

      {managementTarget && ((managementTarget.destination === "judicial" && canViewCollisions) || (managementTarget.destination === "insurance" && canViewInsuranceWorkflow)) && (
        <div className="incident-claim-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeManagement(); }}>
          <section className={`incident-claim-modal incident-management-modal--${managementTarget.destination}`} role="dialog" aria-modal="true" aria-labelledby="incident-management-modal-title">
            <div className="incident-claim-modal-head"><div><span className="workflow-eyebrow">Gestión del expediente</span><h2 id="incident-management-modal-title">{managementTarget.destination === "judicial" ? "Juicio" : "Reclamo al seguro"}</h2></div><button type="button" className="button" aria-label={`Cerrar gestión ${managementTarget.destination === "judicial" ? "del juicio" : "del reclamo"}`} autoFocus onClick={closeManagement}>Cerrar</button></div>
            {managementTarget.destination === "judicial" ? <CollisionsPage
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
            /> : <InsuranceWorkflowPage
              key={`insurance-${managementTarget.id}`}
              clients={clients}
              dataOwnerUserId={dataOwnerUserId}
              readOnly={!canEditInsuranceWorkflow}
              embedded
              hideCreateForm
              initialExpandedId={managementTarget.id}
              focusedClaimId={managementTarget.id}
            />}
          </section>
        </div>
      )}
    </section>
  );
}
