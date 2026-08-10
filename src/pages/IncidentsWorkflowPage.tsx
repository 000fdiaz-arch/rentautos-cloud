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
};

type ManagementTarget = { destination: IncidentDestination; id: string; search: string };

export default function IncidentsWorkflowPage({
  clients,
  dataOwnerUserId,
  canViewCollisions,
  canEditCollisions,
  canViewInsuranceWorkflow,
  canEditInsuranceWorkflow,
  onClientsChange
}: Props) {
  const [managementTarget, setManagementTarget] = useState<ManagementTarget | null>(null);
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);

  function handleIncidentSaved(): void {
    setFollowUpRefreshKey((current) => current + 1);
    setManagementTarget(null);
  }

  useEffect(() => {
    if (managementTarget?.destination !== "insurance") return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setManagementTarget(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [managementTarget?.destination]);

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

      {!managementTarget && <UnifiedIncidentsFollowUp
        dataOwnerUserId={dataOwnerUserId}
        canViewJudicial={canViewCollisions}
        canViewInsurance={canViewInsuranceWorkflow}
        refreshKey={followUpRefreshKey}
        onOpen={(destination, target) => setManagementTarget({ destination, ...target })}
      />}

      {managementTarget?.destination === "judicial" && <div className="incident-management-back"><button type="button" className="button" onClick={() => { setManagementTarget(null); setFollowUpRefreshKey((current) => current + 1); }}>← Volver a expedientes</button><span>Gestionando juicio</span></div>}

      {managementTarget?.destination === "judicial" && canViewCollisions && (
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
          initialSearch={managementTarget.search}
        />
      )}
      {managementTarget?.destination === "insurance" && canViewInsuranceWorkflow && (
        <div className="incident-claim-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setManagementTarget(null); setFollowUpRefreshKey((current) => current + 1); } }}>
          <section className="incident-claim-modal" role="dialog" aria-modal="true" aria-labelledby="incident-claim-modal-title">
            <div className="incident-claim-modal-head"><div><span className="workflow-eyebrow">Gestión del expediente</span><h2 id="incident-claim-modal-title">Reclamo al seguro</h2></div><button type="button" className="button" aria-label="Cerrar gestión del reclamo" onClick={() => { setManagementTarget(null); setFollowUpRefreshKey((current) => current + 1); }}>Cerrar</button></div>
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
          </section>
        </div>
      )}
    </section>
  );
}
