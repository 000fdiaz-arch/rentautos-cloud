import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AppNavigation from "../../src/app/AppNavigation";
import { usePendingLeadReviewCount } from "../../src/app/usePendingLeadReviewCount";
import { markSellerLeadRequestReviewed, markSellerLeadRequestIncomplete } from "../../src/cloud/sellerLeadRequestCloudData";
import "../../src/styles.css";

function Harness() {
  const [owner, setOwner] = useState("11111111-1111-4111-8111-111111111111");
  const [enabled, setEnabled] = useState(true);
  const count = usePendingLeadReviewCount(owner, enabled);
  return <>
    <AppNavigation page="payments" canViewLeads={enabled} canViewClients canViewPayments canViewReceivables
      canViewRouteSearch canViewIncidents canViewControlUnits canViewSettings
      pendingLeadReviewCount={count} syncStatus="ok" syncErrorMessage="" lastSyncAt=""
      canSignOut={false} onPageChange={() => {}} onSignOut={() => {}} />
    <main className="page">
      <button onClick={() => void markSellerLeadRequestReviewed("request-test", "evaluation-test")}>Publicar prueba</button>
      <button onClick={() => void markSellerLeadRequestIncomplete("request-test", "Corregir prueba")}>Corregir prueba</button>
      <button onClick={() => setOwner("22222222-2222-4222-8222-222222222222")}>Cambiar dataset</button>
      <button onClick={() => setEnabled(false)}>Retirar permiso</button>
    </main>
  </>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
