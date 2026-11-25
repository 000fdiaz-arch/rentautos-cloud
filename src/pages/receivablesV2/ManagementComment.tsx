import { useWorkdayValue } from './workdayProgress';
export function managementCommentKey(scope:string,clientId:string){return scope+':management-comment:'+clientId;}
export function readManagementComment(key:string):string{try{const value=JSON.parse(localStorage.getItem(key)??'""');return typeof value==='string'?value.trim():'';}catch{return '';}}
export function ManagementComment({scope,clientId,disabled=false}:{scope:string;clientId:string;disabled?:boolean}){
 const [comment,setComment]=useWorkdayValue(managementCommentKey(scope,clientId),'');
 return <label className="cxc-management-comment"><span>Comentario de esta gestión <small>(opcional)</small></span><textarea rows={2} maxLength={2000} value={comment} disabled={disabled} onChange={event=>setComment(event.target.value)} placeholder="Información de este contacto…"/></label>;
}
