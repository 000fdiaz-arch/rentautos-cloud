import assert from 'node:assert/strict';import {build} from 'esbuild';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),module={exports:{}};
const out=await build({entryPoints:['src/pages/receivablesV2/PaymentReviewForm.tsx'],bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,packages:'external'});vm.runInNewContext(out.outputFiles[0].text,{module,exports:module.exports,require,Date,Intl,localStorage:{getItem:()=>null}});
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function render(total,overdue){return renderToStaticMarkup(React.createElement(module.exports.PaymentReviewForm,{draftKey:'test',unit:'C01',name:'Test',today:'2026-11-25',row:{rentAmount:33,totalPending:total,overdueBalance:overdue},review:{total:33,received:[{id:'receipt'}],key:'test'},onSave:async()=>{}}));}
const html=render(99,66);assert.match(html,/Renta corriente<\/span><strong>\$33.00<\/strong><small>1 letra<\/small>/);assert.match(html,/Renta vencida<\/span><strong>\$66.00<\/strong><small>2 letras<\/small>/);assert.match(html,/Renta total<\/span><strong>\$99.00<\/strong><small>3 letras<\/small>/);
assert.match(render(10,10),/Renta total<\/span><strong>\$10.00<\/strong><small>1 letra<\/small>/);
assert.match(render(0,0),/Renta total<\/span><strong>\$0.00<\/strong><small>0 letras<\/small>/);
console.log('PASS received-payment render: current, overdue, total letters, partial installment and zero balance.');
