import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {before,after,test} from "node:test";
import {PGlite} from "@electric-sql/pglite";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
let db;
before(async()=>{
 db=new PGlite();
 await db.exec("CREATE SCHEMA auth; CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('fixture.subject',true),'')$$;");
 for(const f of ["202610210001_medication_core","202610220003_medication_stock","202610220004_routine_stock","202610230005_medication_control"]) await db.exec(readFileSync(new URL("../neon/migrations/"+f+".sql",import.meta.url),"utf8"));
 for(const [n,role,owner] of [[1,"owner",null],[2,"viewer",id(1)],[3,"owner",null]]) await db.query("INSERT INTO application_private.accounts(id,auth_subject,source_email,access_role,owner_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())",[id(n),id(100+n),"fixture"+n+"@example.invalid",role,owner]);
 for(const n of [1,2,3]) await db.query("INSERT INTO public.medications(id,user_id,name,dosage) VALUES($1,$2,$3,'Dose não inferida')",[id(10+n),id(n===3?3:1),"Medicamento sintético "+n]);
});
after(async()=>db?.close());
async function asUser(n,fn,role="authenticated"){
 await db.exec("BEGIN");
 try {await db.query("SELECT set_config('fixture.subject',$1,true)",[id(100+n)]);await db.exec("SET LOCAL ROLE "+role);return await fn();}
 finally {await db.exec("ROLLBACK");}
}
const definition={name:"Teste diário",period_description:"Diária",has_no_end_date:true,duration_value:null,duration_unit:null,total_days:null,scheduled_time:"08:00",deadline_time:"09:00",frequency_kind:"daily"};
const activate=(active,med=id(11))=>db.query("SELECT public.set_medication_active($1,$2)",[med,active]);
const stock=(quantity=10,unit="tablet",med=id(11))=>db.query("SELECT public.set_medication_inventory($1,$2,30,$3,$4)",[med,quantity,unit,crypto.randomUUID()]);
const routine=async(rid=null,med=id(11))=>(await db.query("SELECT public.save_routine_with_doses($1,$2,$3) AS id",[rid,{...definition,command_id:crypto.randomUUID()},[{medication_id:med,quantity:2,unit:"tablet"}]])).rows[0].id;
const purchase=async(overrides={},command=crypto.randomUUID())=>{
 const p={med:id(11),quantity:30,unit:"tablet",date:"2026-01-01",pharmacy:"Farmácia de teste",link:"https://example.invalid/compra",timezone:"America/Sao_Paulo",...overrides};
 return (await db.query("SELECT public.record_medication_purchase($1,$2,$3,$4,$5,$6,$7,$8) AS id",[p.med,p.quantity,p.unit,p.date,p.pharmacy,p.link,command,p.timezone])).rows[0].id;
};
const balance=async()=>(await db.query("SELECT quantity FROM public.medication_stock WHERE medication_id=$1",[id(11)])).rows[0]?.quantity;
test("desativar preserva rotina e histórico; medicamento permanece legível e consumo existente continua",()=>asUser(1,async()=>{
 await stock();const r=await routine();await activate(false);
 const row=(await db.query("SELECT * FROM public.medications WHERE id=$1",[id(11)])).rows[0];assert.equal(row.is_active,false);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.routine_medications WHERE routine_id=$1",[r])).rows[0].n,1);
 await db.query("SELECT public.change_routine_intake($1,$2,'confirm',now(),'America/Sao_Paulo')",[crypto.randomUUID(),r]);
 assert.equal(Number(await balance()),8);await activate(true);assert.equal((await db.query("SELECT is_active FROM public.medications WHERE id=$1",[id(11)])).rows[0].is_active,true);
}));
test("rotina nova rejeita medicamento desativado no banco",()=>assert.rejects(asUser(1,async()=>{await activate(false);await routine();}),{code:"42501"}));
test("rotina existente mantém remédio desativado ao editar, sem liberar novos vínculos",()=>asUser(1,async()=>{
 const r=await routine();await activate(false);assert.equal(await routine(r),r);
 await db.exec("SAVEPOINT s");await assert.rejects(routine(),{code:"42501"});await db.exec("ROLLBACK TO SAVEPOINT s");
 await activate(true);assert(await routine());
}));
test("cliente antigo não insere vínculo novo para medicamento desativado",()=>assert.rejects(asUser(1,async()=>{
 await activate(false);
 const r=(await db.query("INSERT INTO public.medication_routines(user_id,name,period_description,has_no_end_date,scheduled_time,deadline_time) VALUES($1,'Legada','Diária',true,'08:00','09:00') RETURNING id",[id(1)])).rows[0].id;
 await db.query("INSERT INTO public.routine_medications(user_id,routine_id,medication_id) VALUES($1,$2,$3)",[id(1),r,id(11)]);
}),{code:"23514"}));
test("compra soma saldo e mantém quantidade, data, farmácia, link e movimento relacionado",()=>asUser(1,async()=>{
 await stock();const pid=await purchase();
 assert.equal(Number(await balance()),40);
 const row=(await db.query("SELECT * FROM public.medication_purchases WHERE id=$1",[pid])).rows[0];
 assert.equal(Number(row.quantity),30);assert.equal(row.pharmacy,"Farmácia de teste");assert.equal(row.reference_url,"https://example.invalid/compra");
 const movement=(await db.query("SELECT * FROM public.stock_movements WHERE purchase_id=$1",[pid])).rows[0];assert.equal(movement.kind,"purchase");assert.equal(Number(movement.quantity_delta),30);
}));
test("retry de compra após consumo não duplica entrada nem restaura o saldo antigo",()=>asUser(1,async()=>{
 await stock();const key=crypto.randomUUID(),a=await purchase({},key),r=await routine();
 await db.query("SELECT public.change_routine_intake($1,$2,'confirm',now(),'America/Sao_Paulo')",[crypto.randomUUID(),r]);
 assert.equal(Number(await balance()),38);assert.equal(await purchase({},key),a);assert.equal(Number(await balance()),38);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchases")).rows[0].n,1);
}));
test("identificador de compra não aceita outro conteúdo",()=>assert.rejects(asUser(1,async()=>{
 await stock();const key=crypto.randomUUID();await purchase({},key);await purchase({quantity:10},key);
}),/Identificador/));
test("saldo desconhecido exige conferência física antes da primeira compra",()=>assert.rejects(asUser(1,async()=>{await stock(null);await purchase();}),/saldo físico/));
test("compras em ml aceitam frações e preservam a unidade",()=>asUser(1,async()=>{
 await stock(12.5,"ml");await purchase({quantity:2.125,unit:"ml",link:null});assert.equal(Number(await balance()),14.625);
}));
test("falha na compra reverte compra, entrada e comando juntos",()=>asUser(1,async()=>{
 await stock();await db.exec("SAVEPOINT s");await assert.rejects(purchase({link:"javascript:alert(1)"}),{code:"23514"});await db.exec("ROLLBACK TO SAVEPOINT s");
 assert.equal(Number(await balance()),10);assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchases")).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.stock_movements WHERE kind='purchase'")).rows[0].n,0);
}));
test("limites, datas, farmácia e unidade são validados pelo banco",async()=>{
 for(const p of [{quantity:0},{quantity:-1},{quantity:.0001},{quantity:999999999.999},{date:"9999-12-31"},{date:null},{pharmacy:" "},{unit:"ml"},{timezone:"Invalid/Timezone"}]){
   await assert.rejects(asUser(1,async()=>{await stock();await purchase(p);}));
 }
});
test("visualizador pode ler compras do proprietário e não pode alterar estoque ou ativação",async()=>{
 await assert.rejects(asUser(2,()=>activate(false)),{code:"42501"});
 await assert.rejects(asUser(2,()=>purchase()),{code:"42501"});
 await db.exec("BEGIN");
 try {
  await db.query("SELECT set_config('fixture.subject',$1,true)",[id(101)]);await db.exec("SET LOCAL ROLE authenticated");await stock();await purchase();
  await db.query("SELECT set_config('fixture.subject',$1,true)",[id(102)]);
  assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchases")).rows[0].n,1);
  await db.query("SELECT set_config('fixture.subject',$1,true)",[id(103)]);
  assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchases")).rows[0].n,0);
 }finally{await db.exec("ROLLBACK");}
});
test("outro proprietário e anônimo não ganham acesso a compras ou ativação alheias",async()=>{
 await assert.rejects(asUser(3,()=>activate(false)),{code:"42501"});
 await assert.rejects(asUser(3,()=>purchase()),{code:"42501"});
 await assert.rejects(asUser(1,()=>purchase(),"anonymous"),{code:"42501"});
});
test("cliente não pode apagar ou adulterar compras registradas",async()=>{
 for(const query of ["DELETE FROM public.medication_purchases","UPDATE public.medication_purchases SET quantity=999","INSERT INTO public.medication_purchases DEFAULT VALUES"]){
  await assert.rejects(asUser(1,async()=>{await stock();await purchase();await db.exec(query);}),{code:"42501"});
 }
});
