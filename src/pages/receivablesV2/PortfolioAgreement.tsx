import { formatCurrency } from "../../format";
import { FIRST_CONTACT_LABELS } from "./FirstContactSummary";
import type { promiseFollowup } from "./promiseFollowup";
import type { portfolioFollowupToday } from "./workdayProgress";

export function PortfolioAgreement({ followup, latest }: {
  followup: ReturnType<typeof promiseFollowup>;
  latest: NonNullable<ReturnType<typeof portfolioFollowupToday>>;
}) {
  const promise = followup?.promise;
  return <section className="ar-deposit-promise" aria-label="Acuerdo pactado">
    <strong>Esta unidad ya fue atendida en promesas</strong>
    <p>{FIRST_CONTACT_LABELS[latest.result]}{latest.note ? ` · ${latest.note}` : ""}</p>
    {promise && <>
      <div className="cxc-promise-highlight">
        <span>ACUERDO PACTADO</span>
        <strong>{formatCurrency(promise.promiseAmount ?? 0)}</strong>
        <b>{promise.promiseDate?.split("-").reverse().join("/")} · {promise.promiseTime} (hora de Panamá)</b>
      </div>
      <div className="cxc-promise-progress">
        <span className="cxc-promise-paid">Pagó <b>{formatCurrency(followup!.paid)}</b></span>
        <span className="cxc-promise-remaining">Falta <b>{formatCurrency(followup!.remaining)}</b></span>
      </div>
    </>}
    {latest.comment && <p>{latest.comment}</p>}
    <p>Puedes continuar con la siguiente unidad. El acuerdo y su historial se conservan.</p>
  </section>;
}
