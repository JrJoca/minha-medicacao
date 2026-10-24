import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {before,after,test} from "node:test";
import {PGlite} from "@electric-sql/pglite";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
let db;
before(async()=>{
 db=new PGlite();await db.exec("CREATE SCHEMA auth; CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('fixture.subject',true),'')$$;");
 for(const f of ["202610210001_medication_core","202610220003_medication_stock","202610220004_routine_stock","202610230005_medication_control","202610240006_purchase_corrections"])await db.exec(readFileSync(new URL("../neon/migrations/"+f+".sql",import.meta.url),"utf8"));
 for(const [n,role,owner]of [[1,"owner",null],[2,"viewer",id(1)],[3,"owner",null]])await db.query("INSERT INTO application_private.accounts(id,auth_subject,source_email,access_role,owner_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())",[id(n),id(100+n),"fixture"+n+"@example.invalid",role,owner]);
 for(const n of [1,3])await db.query("INSERT INTO public.medications(id,user_id,name,dosage) VALUES($1,$2,$3,'Somente teste')",[id(10+n),id(n),"Medicamento "+n]);
});
after(async()=>db?.close());
async function asUser(n,fn,role="authenticated"){await db.exec("BEGIN");try{await db.query("SELECT set_config('fixture.subject',$1,true)",[id(100+n)]);await db.exec("SET LOCAL ROLE "+role);return await fn();}finally{await db.exec("ROLLBACK");}}
const stock=(quantity=10,unit="tablet")=>db.query("SELECT public.set_medication_inventory($1,$2,30,$3,$4)",[id(11),quantity,unit,crypto.randomUUID()]);
const buy=async(quantity=10,unit="tablet",command=crypto.randomUUID())=>(await db.query("SELECT public.record_medication_purchase($1,$2,$3,'2026-01-01','Farmácia original','https://example.invalid/original',$4,'America/Sao_Paulo') AS id",[id(11),quantity,unit,command])).rows[0].id;
const receipt=async(pid)=>(await db.query("SELECT * FROM public.medication_purchases WHERE id=$1",[pid])).rows[0];
const balance=async()=>Number((await db.query("SELECT quantity FROM public.medication_stock WHERE medication_id=$1",[id(11)])).rows[0].quantity);
async function correct(pid,changes={},revision=0,command=crypto.randomUUID()){
 const p={quantity:6,date:"2026-01-02",pharmacy:"Farmácia corrigida",link:null,reason:"Quantidade da compra corrigida",...changes};
 return (await db.query("SELECT public.correct_medication_purchase($1,$2,$3,$4,$5,$6,$7,$8,'America/Sao_Paulo') AS result",[pid,p.quantity,p.date,p.pharmacy,p.link,p.reason,revision,command])).rows[0].result;
}
const definition={name:"Rotina teste",period_description:"Diária",has_no_end_date:true,duration_value:null,duration_unit:null,total_days:null,scheduled_time:"08:00",deadline_time:"09:00",frequency_kind:"daily"};
async function routine(){return(await db.query("SELECT public.save_routine_with_doses(NULL,$1,$2) AS id",[{...definition,command_id:crypto.randomUUID()},[{medication_id:id(11),quantity:2,unit:"tablet"}]])).rows[0].id;}
async function take(r,action="confirm",intake=null,at="2026-01-01T12:00:00Z"){return(await db.query("SELECT public.change_routine_intake($1,$2,$3,$4,'America/Sao_Paulo',$5) AS result",[crypto.randomUUID(),r,action,at,intake])).rows[0].result;}

test("corrigir compra ajusta a diferença, preserva tomada e estorno usa o consumo original",()=>asUser(1,async()=>{
 await stock();const pid=await buy(),r=await routine(),intake=await take(r);assert.equal(await balance(),18);
 const oldPurchaseMovement=(await db.query("SELECT * FROM public.stock_movements WHERE purchase_id=$1",[pid])).rows[0];
 const result=await correct(pid);assert.equal(Number(result.quantity),6);assert.equal(Number(result.revision),1);assert.equal(await balance(),14);
 const audit=(await db.query("SELECT * FROM public.medication_purchase_corrections WHERE purchase_id=$1",[pid])).rows[0];
 assert.equal(Number(audit.quantity_delta),-4);assert.equal(Number(audit.snapshot_before.quantity),10);assert.equal(Number(audit.snapshot_after.quantity),6);assert(audit.stock_movement_id);
 assert.deepEqual((await db.query("SELECT * FROM public.stock_movements WHERE purchase_id=$1",[pid])).rows[0],oldPurchaseMovement);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_intakes")).rows[0].n,1);
 await take(r,"undo",intake.id);assert.equal(await balance(),16);
}));
test("corrigir somente data, farmácia e link não movimenta o saldo",()=>asUser(1,async()=>{
 await stock();const pid=await buy(),before=(await db.query("SELECT * FROM public.medication_stock")).rows;
 const movements=(await db.query("SELECT * FROM public.stock_movements")).rows,old=await receipt(pid);
 await correct(pid,{quantity:10,link:"https://example.invalid/corrigido"});
 assert.deepEqual((await db.query("SELECT * FROM public.medication_stock")).rows,before);assert.deepEqual((await db.query("SELECT * FROM public.stock_movements")).rows,movements);
 const current=await receipt(pid);assert.equal(current.pharmacy,"Farmácia corrigida");assert.deepEqual(current.created_at,old.created_at);
 const audit=(await db.query("SELECT * FROM public.medication_purchase_corrections")).rows[0];assert.equal(Number(audit.quantity_delta),0);assert.equal(audit.stock_movement_id,null);
}));
test("aumentar quantidade acrescenta apenas as unidades da correção",()=>asUser(1,async()=>{
 await stock();const pid=await buy();await correct(pid,{quantity:15});assert.equal(await balance(),25);
}));
test("repetir correção após consumo não reaplica ajuste nem cria auditoria duplicada",()=>asUser(1,async()=>{
 await stock();const pid=await buy(),key=crypto.randomUUID();const first=await correct(pid,{quantity:12},0,key);const r=await routine();await take(r);assert.equal(await balance(),20);
 assert.deepEqual(await correct(pid,{quantity:12},0,key),first);assert.equal(await balance(),20);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchase_corrections")).rows[0].n,1);
}));
test("versão antiga é recusada e recarregar permite nova correção sem perder a anterior",()=>asUser(1,async()=>{
 await stock();const pid=await buy();await correct(pid,{quantity:12});await db.exec("SAVEPOINT s");await assert.rejects(correct(pid,{quantity:7}),{code:"40001"});await db.exec("ROLLBACK TO SAVEPOINT s");assert.equal(await balance(),22);
 await correct(pid,{quantity:7},1);assert.equal(await balance(),17);assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchase_corrections")).rows[0].n,2);
}));
test("identificador da correção não pode ser reutilizado com outro conteúdo",()=>assert.rejects(asUser(1,async()=>{
 await stock();const pid=await buy(),key=crypto.randomUUID();await correct(pid,{},0,key);await correct(pid,{quantity:9},0,key);
}),/Identificador/));
test("quantidade corrigida insuficiente sinaliza saldo negativo preservando as tomadas",()=>asUser(1,async()=>{
 await stock(0);const pid=await buy(),r=await routine();for(let d=1;d<=6;d++)await take(r,"confirm",null,"2026-01-0"+d+"T12:00:00Z");
 assert.equal(await balance(),-2);await correct(pid,{quantity:5});assert.equal(await balance(),-7);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_intakes")).rows[0].n,6);
}));
test("correção em ml aceita frações sem mudar unidade ou embalagem",()=>asUser(1,async()=>{
 await stock(1.5,"ml");const pid=await buy(10.5,"ml");await correct(pid,{quantity:12.625});assert.equal(await balance(),14.125);
 assert.equal((await receipt(pid)).unit,"ml");assert.equal(Number((await db.query("SELECT quantity_per_package FROM public.medication_stock")).rows[0].quantity_per_package),30);
}));
test("erro de link reverte saldo, compra, movimento e auditoria na mesma transação",()=>asUser(1,async()=>{
 await stock();const pid=await buy(),old=await receipt(pid),movements=(await db.query("SELECT * FROM public.stock_movements")).rows;
 await db.exec("SAVEPOINT s");await assert.rejects(correct(pid,{link:"javascript:alert(1)"}),{code:"23514"});await db.exec("ROLLBACK TO SAVEPOINT s");
 assert.equal(await balance(),20);assert.deepEqual(await receipt(pid),old);assert.deepEqual((await db.query("SELECT * FROM public.stock_movements")).rows,movements);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchase_corrections")).rows[0].n,0);
}));
test("data, precisão, limites e motivo inválidos não corrigem compras",async()=>{
 for(const p of [{quantity:0},{quantity:-1},{quantity:.0001},{quantity:999999999.999},{date:"9999-12-31"},{pharmacy:" "},{reason:" "},{reason:"a".repeat(501)}])await assert.rejects(asUser(1,async()=>{await stock();await correct(await buy(),p);}));
});
test("salvar sem mudanças não cria ajuste ou correção fictícia",()=>asUser(1,async()=>{
 await stock();const pid=await buy(),key=crypto.randomUUID();
 const unchanged={quantity:10,date:"2026-01-01",pharmacy:"Farmácia original",link:"https://example.invalid/original"};
 await correct(pid,unchanged,0,key);await correct(pid,unchanged,0,key);assert.equal(await balance(),20);assert.equal(Number((await receipt(pid)).revision),0);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchase_corrections")).rows[0].n,0);
}));
test("retry do cadastro original da compra não desfaz uma correção posterior",()=>asUser(1,async()=>{
 await stock();const key=crypto.randomUUID(),pid=await buy(10,"tablet",key);await correct(pid);assert.equal(await buy(10,"tablet",key),pid);assert.equal(await balance(),16);assert.equal(Number((await receipt(pid)).quantity),6);
}));
test("visualizador e outro proprietário não corrigem compras; leitura da auditoria segue o proprietário",()=>asUser(1,async()=>{
 await stock();const pid=await buy();await correct(pid);
 await db.query("SELECT set_config('fixture.subject',$1,true)",[id(102)]);assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchase_corrections")).rows[0].n,1);
 await db.exec("SAVEPOINT s");await assert.rejects(correct(pid),{code:"42501"});await db.exec("ROLLBACK TO SAVEPOINT s");
 await db.query("SELECT set_config('fixture.subject',$1,true)",[id(103)]);assert.equal((await db.query("SELECT count(*)::int n FROM public.medication_purchase_corrections")).rows[0].n,0);
 await db.exec("SAVEPOINT t");await assert.rejects(correct(pid),{code:"42501"});await db.exec("ROLLBACK TO SAVEPOINT t");
}));
test("compras e auditoria continuam imutáveis por escrita direta; anônimo não executa correção",async()=>{
 for(const query of ["UPDATE public.medication_purchases SET revision=999","DELETE FROM public.medication_purchase_corrections","INSERT INTO public.medication_purchase_corrections DEFAULT VALUES"])await assert.rejects(asUser(1,async()=>{await stock();await correct(await buy());await db.exec(query);}),{code:"42501"});
 await assert.rejects(asUser(1,()=>correct(id(99)),"anonymous"),{code:"42501"});
});
