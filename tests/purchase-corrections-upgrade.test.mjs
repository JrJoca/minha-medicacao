import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {PGlite} from "@electric-sql/pglite";
const plan=JSON.parse(execFileSync("python3",["-c","import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('s',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps(m.upgrade_queries('synthetic-backup','0'*64)))",fileURLToPath(new URL("../scripts/neon-purchase-corrections.py",import.meta.url))],{encoding:"utf8"}));
async function setup(){
 const db=new PGlite();await db.exec("CREATE SCHEMA auth; CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$SELECT NULL::text$$;");
 for(const f of ["202610210001_medication_core","202610220003_medication_stock","202610220004_routine_stock","202610230005_medication_control"])await db.exec(readFileSync(new URL("../neon/migrations/"+f+".sql",import.meta.url),"utf8"));
 await db.exec("INSERT INTO application_private.accounts(id,source_email,access_role,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000001','synthetic@example.invalid','owner',now(),now());INSERT INTO public.medications(id,user_id,name,dosage) VALUES('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','Preservar','Dose textual');INSERT INTO public.medication_stock(medication_id,user_id,quantity,unit) VALUES('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',20,'tablet');INSERT INTO public.medication_purchases(id,user_id,medication_id,quantity,unit,purchased_on,pharmacy,created_at) VALUES('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',10,'tablet','2026-01-01','Farmácia original','2026-01-01T12:00:00Z');INSERT INTO public.stock_movements(user_id,medication_id,purchase_id,kind,quantity_delta,unit,applied_to_balance,snapshot) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','purchase',10,'tablet',true,'{}');INSERT INTO application_private.stock_commands VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031','{\"action\":\"fixture\"}','{\"id\":\"fixture\"}');");
 return db;
}
async function apply(db,queries=plan){await db.exec("BEGIN");try{for(const q of queries)await db.query(q.query,q.params);await db.exec("COMMIT");}catch(error){await db.exec("ROLLBACK");throw error;}}
test("006 preserva compras, saldos, movimentos, comandos e timestamps, sem correções inferidas",async()=>{
 const db=await setup();try{
  const before=(await db.query("SELECT * FROM public.medication_purchases")).rows[0],movements=(await db.query("SELECT * FROM public.stock_movements")).rows,commands=(await db.query("SELECT * FROM application_private.stock_commands")).rows;
  await apply(db);const after=(await db.query("SELECT * FROM public.medication_purchases")).rows[0];
  for(const key of Object.keys(before))assert.deepEqual(after[key],before[key]);
  assert.equal(Number(after.revision),0);assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchase_corrections")).rows[0].n,0);
  assert.deepEqual((await db.query("SELECT * FROM public.stock_movements")).rows,movements);assert.deepEqual((await db.query("SELECT * FROM application_private.stock_commands")).rows,commands);
  assert.equal(Number((await db.query("SELECT quantity FROM public.medication_stock")).rows[0].quantity),20);
  await assert.rejects(apply(db),{code:"22012"});
 }finally{await db.close();}
});
test("006 reverte a ampliação se uma compra ou comando anterior for alterado",async()=>{
 for(const query of ["UPDATE public.medication_purchases SET quantity=11","UPDATE application_private.stock_commands SET payload='{}'"]){
  const db=await setup();try{
   const bad=structuredClone(plan);bad.splice(bad.findIndex(q=>q.query.includes("existing_data_preserved")),0,{query,params:[]});
   await assert.rejects(apply(db,bad),{code:"22012"});assert.equal((await db.query("SELECT to_regclass('public.medication_purchase_corrections') AS t")).rows[0].t,null);
   assert.equal(Number((await db.query("SELECT quantity FROM public.medication_purchases")).rows[0].quantity),10);
  }finally{await db.close();}
 }
});
