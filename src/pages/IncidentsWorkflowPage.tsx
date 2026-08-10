import { useState } from "react";
import type { Client } from "../types";
import CollisionsPage from "./CollisionsPage";
import InsuranceWorkflowPage from "./InsuranceWorkflowPage";

type Props = {
  clients: Client[];
  dataOwnerUserId?: string | null;
  canViewCollisions: boolean;
  canEditCollisions: boolean;
  canViewInsuranceWorkflow: boolean;
  canEditInsuranceWorkflow: boolean;
  onClientsChange: (next: Client[]) => void | Promise<void>;
};

type Area = "collisions" | "claims";

export default function IncidentsWorkflowPage({
  clients,
  dataOwnerUserId,
  canViewCollisions,
  canEditCollisions,
  canViewInsuranceWorkflow,
  canEditInsuranceWorkflow,
  onClientsChange
}: Props) {
  const [activeArea, setActiveArea] = useState<Area>(canViewCollisions ? "collisions" : "claims");

  return (
    <section className="incidents-workflow-page">
      <div className="panel insurance-workflow-header incidents-workflow-header">
        <div>
          <span className="workflow-eyebrow">Expedientes de choques, juicios y seguros</span>
          <h2>Gestión de siniestros</h2>
          <p className="hint">Administra el proceso judicial y el reclamo al seguro desde un solo lugar.</p>
        </div>
      </div>

      <div className="panel workflow-tabs-panel incidents-area-tabs" aria-label="Áreas de gestión de siniestros">
        {canViewCollisions && (
          <button type="button" className={activeArea === "collisions" ? "active" : ""} onClick={() => setActiveArea("collisions")}>
            Juicios por colisiones
          </button>
        )}
        {canViewInsuranceWorkflow && (
          <button type="button" className={activeArea === "claims" ? "active" : ""} onClick={() => setActiveArea("claims")}>
            Reclamos a seguros
          </button>
        )}
      </div>

      {activeArea === "collisions" && canViewCollisions && (
        <CollisionsPage
          clients={clients}
          dataOwnerUserId={dataOwnerUserId}
          readOnly={!canEditCollisions}
          onClientsChange={onClientsChange}
          embedded
          syncInsuranceClaims={canEditInsuranceWorkflow}
        />
      )}
      {activeArea === "claims" && canViewInsuranceWorkflow && (
        <InsuranceWorkflowPage
          clients={clients}
          dataOwnerUserId={dataOwnerUserId}
          readOnly={!canEditInsuranceWorkflow}
          embedded
        />
      )}
    </section>
  );
}
