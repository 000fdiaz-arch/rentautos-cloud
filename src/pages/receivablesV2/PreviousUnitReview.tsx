import type { ReceivableRow } from '../../receivablesV2';
export function previousPortfolioRow(rows:ReceivableRow[],currentId:string|undefined){const index=rows.findIndex(row=>row.id===currentId);return index>0?rows[index-1]:undefined;}
