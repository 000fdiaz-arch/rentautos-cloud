import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LeadsPage from "../../src/pages/LeadsPage";
import { useLeadCloudData } from "../../src/app/useLeadCloudData";
import "../../src/styles.css";

function Harness() {
  const [owner, setOwner] = useState("11111111-1111-4111-8111-111111111111");
  const leads = useLeadCloudData(owner, true, true);
  return <><button onClick={() => setOwner("22222222-2222-4222-8222-222222222222")}>Cambiar dataset de prueba</button><LeadsPage
    evaluations={leads.evaluations} onEvaluationsChange={leads.persist}
    onEvaluationSave={leads.save} onEvaluationDelete={leads.remove}
    onEvaluationFind={leads.find} onEvaluationLoad={leads.loadDocument}
    onLoadMore={leads.loadMore} onRefresh={leads.refresh} hasMore={leads.hasMore}
    loading={leads.loading} cloudError={leads.error} ownerUserId={owner}
    readOnly={new URLSearchParams(location.search).has("readonly")}
  /></>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
