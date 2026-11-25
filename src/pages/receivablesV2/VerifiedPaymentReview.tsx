import { useEffect, useState } from "react";
import type { ReceivableRow } from "../../receivablesV2";
import { PaymentReviewForm, type PaymentReviewFormProps } from "./PaymentReviewForm";

export function VerifiedPaymentReview({ loadRow, ...props }: PaymentReviewFormProps & {
  loadRow?: (row: ReceivableRow) => Promise<ReceivableRow>;
}) {
  const [verified, setVerified] = useState<{ source: ReceivableRow; row: ReceivableRow } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!loadRow) return;
    let cancelled = false;
    setVerified(null); setError("");
    loadRow(props.row).then(row => {
      if (!cancelled) setVerified({ source: props.row, row });
    }).catch(() => {
      if (!cancelled) setError("No se pudo verificar el saldo actual.");
    });
    return () => { cancelled = true; };
  }, [loadRow, props.row, retry]);
  if (loadRow && (!verified || verified.source !== props.row)) return <section className="ar-followup-summary" aria-live="polite">
    <h3>Pago recibido · {props.unit}</h3>
    <p>{error || "Verificando saldo actual…"}</p>
    {error && <button className="button" onClick={() => setRetry(value => value + 1)}>Reintentar</button>}
  </section>;
  return <PaymentReviewForm {...props} row={verified?.row ?? props.row} />;
}
