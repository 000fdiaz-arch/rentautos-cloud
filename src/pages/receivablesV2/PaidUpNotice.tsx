import "./paidUpNotice.css";
import { useState } from "react";

export function PaidUpNotice({ onContinue }: { onContinue?: () => void | Promise<void> }) {
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  return <section className="cxc-paid-up" aria-label="Cuenta al día">
    <div className="cxc-paid-up-content">
      <strong className="cxc-paid-up-title"><span aria-hidden="true">✓</span> Al día</strong>
      <p>Revisa WhatsApp y confirma que todo concuerda y no hay anomalías.</p>
      <button type="button" disabled={saving || !onContinue} onClick={async()=>{setSaving(true);setError('');try{await onContinue?.();}catch{setError('No se pudo guardar la revisión. Intenta nuevamente.');}finally{setSaving(false);}}}>{saving?'Guardando…':'Todo al día y continuar'} <span aria-hidden="true">→</span></button>
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
