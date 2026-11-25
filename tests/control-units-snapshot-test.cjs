const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const exportsForTest={};let result,calls=0;
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/cloud/controlUnitsSnapshot.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
 exports:exportsForTest,require(name){if(name.endsWith('cloudClient'))return{getCloudClient:()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'read_control_units_snapshot');assert.equal(args.p_user_id,'OWNER');return result;}})};throw Error(name);}
});
(async()=>{
 const rows=Array.from({length:2501},(_,i)=>({fleet_id:String(i),user_id:'owner',unit_id:`A${i}`,financial_balance:i+0.25,catalog_daily_rate:23,key_coded:i%2===0}));
 result={data:{version:1,owner:'owner',rows},error:null};
 assert.equal((await exportsForTest.loadControlUnitsSnapshot('OWNER')).length,2501);
 assert.equal(JSON.stringify(await exportsForTest.loadControlUnitsSnapshot('OWNER')),JSON.stringify(rows));
 result.data.rows=[];assert.equal((await exportsForTest.loadControlUnitsSnapshot('OWNER')).length,0);
 for(const code of['PGRST202','42883']){result={data:null,error:{code}};assert.equal(await exportsForTest.loadControlUnitsSnapshot('OWNER'),null);}
 for(const code of['42501','08006']){result={data:null,error:{code}};await assert.rejects(exportsForTest.loadControlUnitsSnapshot('OWNER'),e=>e.code===code);}
 for(const data of[null,{version:2,owner:'owner',rows},{version:1,owner:'other',rows},{version:1,owner:'owner',rows:[null]},{version:1,owner:'owner',rows:[{fleet_id:'x',user_id:'other'}]},{version:1,owner:'owner',rows:[rows[0],rows[0]]}]){
  result={data,error:null};await assert.rejects(exportsForTest.loadControlUnitsSnapshot('OWNER'));
 }
 console.log('PASS fleet snapshot: all 2501 rows/fields, empty cloud, owner validation, duplicate/malformed rejection, permission/network errors and legacy fallback.');
})().catch(e=>{console.error(e);process.exitCode=1;});
