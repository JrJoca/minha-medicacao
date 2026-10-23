import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {PGlite} from "@electric-sql/pglite";
const plan=JSON.parse(execFileSync("python3",["-c","import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('s',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps(m.upgrade_queries('synthetic-backup','0'*64)))",fileURLToPath(new URL("../scripts/neon-medication-control.py",import.meta.url))],{encoding:"utf8"}));
async function setup(){
 const db=new PGlite();await db.exec("CREATE SCHEMA auth; CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$SELECT NULL::text$$;");
 for(const f of ["202610210001_medication_core","202610220003_medication_stock","202610220004_routine_stock"])await db.exec(readFileSync(new URL("../neon/migrations/"+f+".sql",import.meta.url),"utf8"));
 await db.exec("INSERT INTO application_private.accounts(id,source_email,access_role,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000001','synthetic@example.invalid','owner',now(),now());INSERT INTO public.medications(id,user_id,name,dosage) VALUES('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','Preservar','Dose textual');INSERT INTO public.medication_stock(medication_id,user_id,quantity,unit) VALUES('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',10,'tablet');INSERT INTO public.stock_movements(user_id,medication_id,kind,quantity_delta,unit,applied_to_balance,snapshot) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','opening',10,'tablet',true,'{}');");
 return db;
}
async function apply(db,queries=plan){
 await db.exec("BEGIN");try{for(const q of queries)await db.query(q.query,q.params);await db.exec("COMMIT");}catch(error){await db.exec("ROLLBACK");throw error;}
}
test("005 mantém cadastros ativos e preserva saldos, timestamps e trilha; nenhuma compra inferida",async()=>{
 const db=await setup();try{
  const before=(await db.query("SELECT * FROM public.medications")).rows[0],stock=(await db.query("SELECT * FROM public.medication_stock")).rows[0];
  await apply(db);const after=(await db.query("SELECT * FROM public.medications")).rows[0];
  for(const key of Object.keys(before))assert.deepEqual(after[key],before[key]);
  assert.equal(after.is_active,true);assert.deepEqual((await db.query("SELECT * FROM public.medication_stock")).rows[0],stock);
  assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchases")).rows[0].n,0);
  assert.equal((await db.query("SELECT count(*)::int n FROM public.stock_movements")).rows[0].n,1);
  await assert.rejects(apply(db),{code:"22012"});
 }finally{await db.close();}
});
test("005 reverte toda a ampliação se qualquer dado antigo for alterado",async()=>{
 const db=await setup();try{
  const bad=structuredClone(plan);bad.splice(bad.findIndex(q=>q.query.includes("existing_data_preserved")),0,{query:"UPDATE public.medication_stock SET quantity=999",params:[]});
  await assert.rejects(apply(db,bad),{code:"22012"});
  assert.equal((await db.query("SELECT to_regclass('public.medication_purchases') AS t")).rows[0].t,null);
  assert.equal(Number((await db.query("SELECT quantity FROM public.medication_stock")).rows[0].quantity),10);
 }finally{await db.close();}
});
