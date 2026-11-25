import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const file of [".env", ".env.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
const operator = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options);
const { data: profiles, error } = await admin.from("user_profiles").select("*").eq("role", "operador").eq("is_active", true);
if (error) throw error;
const template = profiles.find(p => p.permissions?.receivables?.edit && p.permissions?.receivables?.view);
assert.ok(template);
const email = "verification-" + randomUUID() + "@auth.rentautos.local";
const password = randomUUID() + "aA9!";
const id = "__verification_rls_" + randomUUID();
let userId;
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const profile = await admin.from("user_profiles").upsert({
    id: userId, email, role: "operador", is_active: true,
    data_owner_user_id: template.data_owner_user_id, permissions: template.permissions
  });
  if (profile.error) throw profile.error;
  const signed = await operator.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;

  const compiled = await build({
    stdin: { contents: 'export {syncCloudStreetManagementDelta} from "./src/cloud/operationsCloudData"; export {parseCollectionStatusMapFromStorage} from "./src/pages/receivables/receivablesPageRules";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", write: false, define: { "import.meta.env.DEV": "false" },
    plugins: [{name:"authenticated-test-client",setup(builder){builder.onResolve({filter:/lib\/supabase$/},()=>({path:"test-auth-client",external:true}));}}]
  });
  const realRequire=createRequire(import.meta.url);
  const module={exports:{}};
  vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:name=>name==="test-auth-client"?{supabase:operator}:realRequire(name),console,Date,Intl,URL,TextEncoder,TextDecoder,setTimeout,clearTimeout});
  const actual=module.exports;
  const pageSource = fs.readFileSync("src/pages/ReceivablesPage.tsx", "utf8");
  const handler = pageSource.slice(pageSource.indexOf("  async function handleContactOutcome"), pageSource.indexOf("  function setDailyContactSaveState"));
  const gpsHandler = pageSource.slice(pageSource.indexOf("  async function handleGpsLocationReview"), pageSource.indexOf("  async function handleContactOutcome"));
  const date = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Panama",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const future = new Date(Date.now() + 86400000).toISOString().slice(0,10);
  for (const collector of ["collector-1", "collector-2"]) {
    const original = { date, at: new Date(Date.now()-3600000).toISOString(), collector, result:"promise", promiseDate:date, promiseTime:"01:00", promiseAmount:100 };
    for (const result of ["no_answer", "reported_paid", "escalated", "promise"]) {
      const initial = {status:"pending",comment:"",updatedAt:original.at,contactOutcomes:[original]};
      const seed=await operator.from("street_management_items_cloud").upsert({user_id:template.data_owner_user_id,client_id:id,data:initial});
      if(seed.error)throw seed.error;
      let published;
      const ctx = { Date, Intl, Number, Object, Error, isCollectionLocked:false, activeCollector:collector, dataOwnerUserId:template.data_owner_user_id, supabase:operator, todayDateKey:date,
        latestCollectionStatusByClientRef:{current:{[id]:initial}},optimisticStatusByClientRef:{current:{}},streetPersistQueueRef:{current:Promise.resolve()},
        parseCollectionStatusMapFromStorage:actual.parseCollectionStatusMapFromStorage,
        setCollectionStatusByClient(update) {published=update({[id]:initial});},
        syncCloudStreetManagementDelta:actual.syncCloudStreetManagementDelta
      };
      vm.createContext(ctx);vm.runInContext(ts.transpile(handler + gpsHandler,{target:9}),ctx);
      if (result === "promise") {
        // The form submits a complete draft; no prerequisite field-change writes.
        const draft={date, time:"12:00", amount:25};
        await ctx.handleContactOutcome(id,"promise",undefined,draft);
        const reloaded=await operator.from("street_management_items_cloud").select("data").eq("user_id",template.data_owner_user_id).eq("client_id",id).single();
        if(reloaded.error) throw reloaded.error;
        const restored=actual.parseCollectionStatusMapFromStorage(JSON.stringify({[id]:reloaded.data.data}))[id];
        assert.equal(restored.paymentPromiseDate,draft.date);
        assert.equal(restored.paymentPromiseTime,draft.time);
        assert.equal(restored.paymentPromiseAmount,draft.amount);
        console.log("PASS complete promise draft survives real DB reload",collector);
        await operator.from("street_management_items_cloud").upsert({user_id:template.data_owner_user_id,client_id:id,data:initial});
        ctx.latestCollectionStatusByClientRef.current={[id]:initial};
      }
      if (result === "no_answer") {
        await ctx.handleGpsLocationReview(id, "Revisión GPS de prueba aislada");
        const gpsRead = await operator.from("street_management_items_cloud").select("data").eq("user_id",template.data_owner_user_id).eq("client_id",id).single();
        if(gpsRead.error) throw gpsRead.error;
        assert.equal(gpsRead.data.data.gpsLocationNote,"Revisión GPS de prueba aislada");
        assert.ok(gpsRead.data.data.gpsLocationReviewedAt);
        assert.ok(published[id].gpsLocationReviewedAt);
        published=undefined;
        ctx.syncCloudStreetManagementDelta=async()=>{throw Error("GPS write failed")};
        await assert.rejects(()=>ctx.handleGpsLocationReview(id,"changed"));
        assert.equal(published,undefined);
        ctx.syncCloudStreetManagementDelta=actual.syncCloudStreetManagementDelta;
        const goodClient=ctx.supabase;
        ctx.supabase={from(){return {select(){return this},eq(){return this},async single(){return {error:new Error("GPS read failed")}}}}};
        await assert.rejects(()=>ctx.handleGpsLocationReview(id,"changed"));
        assert.equal(published,undefined);ctx.supabase=goodClient;
        console.log("PASS GPS",collector,"real database write/read; failures do not publish success");
      }
      const input={promiseAt:original.at,nextDate:future,nextTime:"23:00",amount:60,note:"Prueba aislada de seguimiento",sendToRoute:result==="escalated"};
      await ctx.handleContactOutcome(id,result,input);
      const read=await operator.from("street_management_items_cloud").select("data").eq("user_id",template.data_owner_user_id).eq("client_id",id).single();if(read.error)throw read.error;
      const saved=read.data.data;
      assert.equal(saved.contactOutcomes.length,2);assert.deepEqual(saved.contactOutcomes[0],original);
      assert.equal(saved.contactOutcomes[1].result,result);assert.equal(saved.contactOutcomes[1].followupOf,original.at);
      assert.equal(saved.contactOutcomes[1].note,input.note);assert.ok(published);
      if(result==="promise")assert.equal(saved.paymentPromiseAmount,60);
      if(result==="escalated")assert.equal(saved.isRouteTagged,true);
      const ledger=fs.readFileSync("src/pages/receivables/ReceivablesLedgerTable.tsx","utf8");
      const marker="onSave={async (result, input) => {";
      const navBody=ledger.slice(ledger.indexOf(marker)+marker.length,ledger.indexOf("}}/> : undefined}",ledger.indexOf(marker)));
      let position=9, hot=id, busy=false;
      const nav={result,input,row:{id},visibleRow:{id:"other-unit"},dueFollowups:[],shownPromises:[],pendingIds:[],readyPendingIds:[],automaticFollowup:false,currentRowIndex:9,nextRowIndex:10,scheduledIds:[],roundRows:Array(20),retryIds:null,
        setOutcomeSaving(v){busy=v},setHotClientId(v){hot=v},setAutomaticFollowup(){},changeSelectedRow(v){position=v},setShownPromises(){},setDeferredIds(){},setSelectedRowId(){},setRetryIds(){},setSelectedRowIndex(){},setRoundFinished(){},
        onContactOutcome:ctx.handleContactOutcome};
      ctx.latestCollectionStatusByClientRef.current={[id]:initial};
      await vm.runInNewContext(ts.transpile("(async()=>{"+navBody+"})()",{target:9}),nav);
      assert.equal(hot,null);assert.equal(position,9);assert.equal(busy,false);
      published=undefined;
      ctx.syncCloudStreetManagementDelta=async()=>{throw Error("simulated write failure")};
      ctx.latestCollectionStatusByClientRef.current={[id]:initial};
      await assert.rejects(()=>ctx.handleContactOutcome(id,result,input));assert.equal(published,undefined);
      ctx.syncCloudStreetManagementDelta=actual.syncCloudStreetManagementDelta;
      ctx.supabase={from(){return {select(){return this},eq(){return this},async single(){return {error:new Error("simulated confirmation read failure")}}}}};
      hot=id; position=9;
      await assert.rejects(()=>vm.runInNewContext(ts.transpile("(async()=>{"+navBody+"})()",{target:9}),nav));
      assert.equal(hot,id);assert.equal(position,9);assert.equal(published,undefined);
      console.log("PASS",collector,result,"production sync + parser; real DB write/read; manual position retained; failed write not published");
    }
  }
} finally {
  const removed = await admin.from("street_management_items_cloud").delete().eq("user_id", template.data_owner_user_id).eq("client_id", id);
  if (removed.error) throw removed.error;
  const remaining=await admin.from("street_management_items_cloud").select("client_id").eq("user_id",template.data_owner_user_id).eq("client_id",id);
  if(remaining.error)throw remaining.error;
  assert.equal(remaining.data.length,0);
  if (userId) {
    const profile = await admin.from("user_profiles").delete().eq("id", userId);
    if (profile.error) throw profile.error;
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw deleted.error;
  }
  console.log("Cleanup completed: temporary operator and verification record removed.");
}
