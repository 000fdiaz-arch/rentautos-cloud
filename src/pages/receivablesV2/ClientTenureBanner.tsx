import { useState } from "react";
export function clientTenurePresentation(days: number | null): {
  tone: "new" | "semi-new" | "established" | "unknown";
  detail: string;
} {
  if (days === null) return { tone: "unknown", detail: "Antigüedad no disponible." };
  if (days < 90) return { tone: "new", detail: "Menos de 90 días como cliente." };
  if (days <= 180) return { tone: "semi-new", detail: "Entre 90 y 180 días como cliente." };
  return { tone: "established", detail: "Más de 180 días como cliente." };
}

export function compactClientTenureLabel(days: number | null, fallback: string): string {
  if (days === null) return fallback;
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `+ ${years} ${years === 1 ? "año" : "años"}`;
  }
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `+ ${months} ${months === 1 ? "mes" : "meses"}`;
  }
  return fallback;
}

export function ClientTenureBanner({days,label,name}:{days:number|null;label:string;name:string}) {
 const [expanded,setExpanded]=useState(false);
 const tenure=clientTenurePresentation(days);
 const compact=compactClientTenureLabel(days,label);
 return <div className={`ar-client-tenure-banner ar-client-tenure-banner--${tenure.tone}`} aria-label={`Antigüedad de ${name}`}>
 <span className="ar-client-tenure-icon" aria-hidden="true">A</span><span className="ar-client-tenure-copy"><small>ANTIGÜEDAD DEL CLIENTE</small><span className="ar-client-tenure-summary"><strong>{expanded?label:compact}</strong>{compact!==label && <button type="button" className="ar-client-tenure-more" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Ver menos':'Ver más'}</button>}</span><span>{tenure.detail}</span></span></div>;
}
