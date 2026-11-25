import assert from 'node:assert/strict';import fs from 'node:fs';import {transform} from 'esbuild';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const source=fs.readFileSync('src/pages/receivablesV2/ReceivableTableRow.tsx','utf8');
const line=source.split('\n').find(x=>x.includes('{isInSharedRoute ? <button'));assert.ok(line);
const body=line.trim().slice(1,-1);const code=await transform('module.exports = ('+body+');',{loader:'tsx',jsx:'automatic',format:'cjs'});
let sent=0,opened=0;
function render(isInSharedRoute){const module={exports:{}};vm.runInNewContext(code.code,{module,require,isInSharedRoute,isOperationallyActive:true,isTodayCollectionClosed:false,row:{id:'C01'},onOpenRoute:()=>opened++,onOpenRoutePreparation:()=>sent++});return module.exports;}
const active=render(true);assert.match(renderToStaticMarkup(active),/En ruta en calle/);assert.doesNotMatch(renderToStaticMarkup(active),/Enviar a ruta/);active.props.onClick();assert.equal(opened,1);assert.equal(sent,0);
render(false).props.onClick();assert.equal(sent,1);
assert.match(source,/previous.isInSharedRoute === next.isInSharedRoute/);
const parent=fs.readFileSync('src/pages/ReceivablesV2Page.tsx','utf8');assert.match(parent,/activeRouteClientIds=\{activeVisibleRouteClientIds\}/);
console.log('PASS active shared route shows En ruta and opens existing route; unassigned unit can send; memo detects realtime route changes.');
for (const [file,id] of [['PendingPromises.tsx','item'],['UnansweredUnits.tsx','row']]) {
 const src=fs.readFileSync('src/pages/receivablesV2/'+file,'utf8');
 const expression=src.match(/\{activeRouteClientIds\?\.has\([\s\S]*?<\/button>\}/)[0].slice(1,-1);
 const compiled=await transform('module.exports = ('+expression+');',{loader:'tsx',jsx:'automatic',format:'cjs'});
 let closed=0,viewed=0,dispatched=0;const module={exports:{}};
 vm.runInNewContext(compiled.code,{module,require,activeRouteClientIds:new Set(['C01']),row:{id:'C01'},item:{row:{id:'C01'}},dialog:{current:{close:()=>closed++}},onOpenRoute:()=>viewed++,onSendToRoute:()=>dispatched++,disabled:false,hasActiveOperationalClient:()=>true});
 assert.match(renderToStaticMarkup(module.exports),/En ruta en calle/);assert.doesNotMatch(renderToStaticMarkup(module.exports),/Enviar a ruta/);
 module.exports.props.onClick();assert.equal(closed,1);assert.equal(viewed,1);assert.equal(dispatched,0);
}
console.log('PASS Promesas and Sin respuesta: shared route state, close modal and view route without redispatch.');
