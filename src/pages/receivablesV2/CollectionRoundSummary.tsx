import { formatCurrency, formatDate } from "../../format";
import "./collectionRoundSummary.css";

type PromiseItem = { id: string; unit: string; name: string; amount: number; remaining: number; date?: string; time?: string };
type PendingItem = { id: string; unit: string; name: string; attempts: number; nextContactAt?: string };
function hour(value?: string) {
  if (!value || !/^\d{2}:\d{2}/.test(value)) return "Sin hora";
  const h = Number(value.slice(0, 2));
  return `${h % 12 || 12}:${value.slice(3, 5)} ${h < 12 ? "a. m." : "p. m."}`;
}
function day(value?: string) { return value ? formatDate(new Date(`${value.slice(0,10)}T12:00:00`)) : "Sin fecha"; }

export function CollectionRoundSummary({collector,date,promises,pending}: {collector:string;date:string;promises:PromiseItem[];pending:PendingItem[]}) {
  const remaining=promises.reduce((sum,item)=>sum+item.remaining,0);
  const fulfilled=promises.filter(item=>item.remaining===0).length;
  return <section className="cxc-round-summary" aria-label="Resumen de la gestión">
    <header className="cxc-summary-heading"><div><small>RESULTADO DE LA GESTIÓN</small><h3>Primera vuelta completada</h3><p>Elige Promesas o Sin respuesta para continuar cuando lo decidas.</p></div><span>{collector} · {day(date)}</span></header>
    <div className="cxc-summary-totals">
      <div><span>Prometieron pagar</span><strong>{promises.length}</strong><small>{fulfilled} promesas cumplidas</small></div>
      <div className="is-pending"><span>Siguen sin contestar</span><strong>{pending.length}</strong><small>Clientes por contactar nuevamente</small></div>
      <div><span>Falta recibir de las promesas</span><strong>{formatCurrency(remaining)}</strong><small>Saldo pendiente de lo acordado</small></div>
    </div>
    <div className="cxc-summary-columns">
      <section className="cxc-summary-list"><header><h4>Prometieron pagar <span>{promises.length}</span></h4><p>Consulta cuándo pagarán y cuánto falta por recibir.</p></header>
        <div className="cxc-summary-table-wrap"><table><thead><tr><th>Unidad / cliente</th><th>Fecha y hora</th><th>Prometió</th><th>Falta pagar</th></tr></thead><tbody>
          {promises.map(item=><tr key={item.id}><td><strong>{item.unit}</strong><span>{item.name}</span></td><td>{day(item.date)}<span>{hour(item.time)}</span></td><td>{formatCurrency(item.amount)}</td><td>{item.remaining===0?<span className="cxc-summary-paid">Cumplida</span>:<strong>{formatCurrency(item.remaining)}</strong>}</td></tr>)}
          {!promises.length && <tr><td colSpan={4}>No se registraron promesas de pago hoy.</td></tr>}
        </tbody></table></div>
      </section>
      <section className="cxc-summary-list"><header><h4>Siguen sin contestar <span>{pending.length}</span></h4><p>Estos clientes aún no han dado una respuesta.</p></header>
        <div className="cxc-summary-table-wrap"><table><thead><tr><th>Unidad / cliente</th><th>Intentos</th><th>Próximo contacto</th></tr></thead><tbody>
          {pending.map(item=><tr key={item.id}><td><strong>{item.unit}</strong><span>{item.name}</span></td><td>{item.attempts}</td><td>{item.nextContactAt?new Intl.DateTimeFormat('es-PA',{timeZone:'America/Panama',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(item.nextContactAt)):'Sin hora programada'}</td></tr>)}
          {!pending.length && <tr><td colSpan={3}>No quedan clientes sin respuesta.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  </section>;
}
