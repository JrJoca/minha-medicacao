import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before,after,test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`CREATE SCHEMA auth; CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('fixture.subject',true),'')$$;`);
 for(const f of ['202610210001_medication_core','202610220003_medication_stock','202610220004_routine_stock']) await db.exec(readFileSync(new URL(`../neon/migrations/${f}.sql`,import.meta.url),'utf8'));
 for(const [n,role,owner] of [[1,'owner',null],[2,'viewer',id(1)],[3,'owner',null]]) await db.query(`INSERT INTO application_private.accounts(id,auth_subject,source_email,access_role,owner_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())`,[id(n),id(100+n),`fixture${n}@example.invalid`,role,owner]);
 for(const n of [1,2,3]) await db.query(`INSERT INTO public.medications(id,user_id,name,dosage) VALUES($1,$2,$3,'500 mg não é quantidade de consumo')`,[id(10+n),id(n===3?3:1),`Fixture ${n}`]);
});
after(async()=>db?.close());
async function asUser(n,fn,role='authenticated') {await db.exec('BEGIN');try {await db.query("SELECT set_config('fixture.subject',$1,true)",[id(100+n)]);await db.exec(`SET LOCAL ROLE ${role}`);return await fn();}finally{await db.exec('ROLLBACK');}}
const definition={name:'Diária',period_description:'Conforme orientação',has_no_end_date:true,duration_value:null,duration_unit:null,total_days:null,scheduled_time:'08:00',deadline_time:'09:00',frequency_kind:'daily'};
const doses=(quantity=2,unit='tablet',medication_id=id(11))=>[{medication_id,quantity,unit}];
async function routine(ds=doses(),rid=null,def=definition){return (await db.query('SELECT public.save_routine_with_doses($1,$2,$3) AS id',[rid,{...def,command_id:crypto.randomUUID()},ds])).rows[0].id;}
async function stock(q=10,unit='tablet',med=id(11)){return db.query('SELECT public.set_medication_inventory($1,$2,30,$3,$4)',[med,q,unit,crypto.randomUUID()]);}
async function change(r,action='confirm',intake=null,at='2026-10-22T12:00:00Z',command=crypto.randomUUID()){return (await db.query("SELECT public.change_routine_intake($1,$2,$3,$4,'America/Sao_Paulo',$5) AS result",[command,r,action,at,intake])).rows[0].result;}
async function balance(m=id(11)){return (await db.query('SELECT quantity FROM public.medication_stock WHERE medication_id=$1',[m])).rows[0]?.quantity;}
async function summary(){return (await db.query('SELECT * FROM public.inventory_summary() WHERE medication_id=$1',[id(11)])).rows[0];}
test('rotina com dois comprimidos, previsão 10/2 e baixa 10→8',()=>asUser(1,async()=>{await stock();const r=await routine();assert.equal(Number((await summary()).estimated_days),5);await change(r);assert.equal(Number(await balance()),8);}));
test('ml e frações são preservados sem conversão para comprimidos',()=>asUser(1,async()=>{await stock(12.5,'ml');const r=await routine(doses(2.5,'ml'));await change(r);assert.equal(Number(await balance()),10);assert.equal((await summary()).unit,'ml');}));
test('saldo insuficiente registra a tomada e sinaliza saldo negativo',()=>asUser(1,async()=>{await stock(1);const r=await routine();await change(r);assert.equal(Number(await balance()),-1);assert.equal(Number((await summary()).estimated_days),0);}));
test('repetição do comando e confirmação do mesmo dia não duplicam baixa; undo usa snapshot',()=>asUser(1,async()=>{await stock();const r=await routine();const key=crypto.randomUUID();const i=await change(r,'confirm',null,undefined,key);await change(r,'confirm',null,undefined,key);await change(r);assert.equal(Number(await balance()),8);await routine(doses(5),r);await change(r,'undo',i.id);assert.equal(Number(await balance()),10);await change(r,'confirm',null,undefined,key);assert.equal(Number(await balance()),10);await change(r);assert.equal(Number(await balance()),5);}));
test('correção de horário e data não debita novamente; conflito é recusado',()=>asUser(1,async()=>{await stock();const r=await routine();const i=await change(r);await change(r,'correct',i.id,'2026-10-21T12:00:00Z');assert.equal(Number(await balance()),8);await change(r);await assert.rejects(change(r,'correct',i.id,'2026-10-22T13:00:00Z'));}));
test('saldo desconhecido não vira zero; estorno após primeira contagem não inventa estoque',()=>asUser(1,async()=>{const r=await routine();assert.equal((await summary()).estimated_days,null);const i=await change(r);assert.equal(await balance(),null);await stock(20);await change(r,'undo',i.id);assert.equal(Number(await balance()),20);}));
test('várias rotinas diárias somam consumo; pausada e frequência não diária não dão previsão enganosa',()=>asUser(1,async()=>{await stock();const r=await routine();const other=await routine(doses(3));assert.equal(Number((await summary()).daily_quantity),5);await db.query("UPDATE public.medication_routines SET status='paused' WHERE id=$1",[other]);assert.equal(Number((await summary()).daily_quantity),2);await routine(doses(),r,{...definition,frequency_kind:'other'});assert.equal((await summary()).estimated_days,null);}));
test('unidade diferente, precisão inválida e medicamento de outro dono revertem toda a operação',async()=>{for(const ds of [doses(2,'ml'),doses(.0001),[...doses(),...doses(1,'tablet',id(13))]]) await assert.rejects(asUser(1,async()=>{await stock();await routine(ds);}));});
test('viewer e outro proprietário não podem configurar, confirmar ou ler saldo alheio',async()=>{await assert.rejects(asUser(2,()=>stock()),{code:'42501'});await assert.rejects(asUser(3,()=>stock()),{code:'42501'});await asUser(3,async()=>assert.equal((await db.query('SELECT * FROM public.inventory_summary() WHERE medication_id=$1',[id(11)])).rows.length,0));});
test('escrita direta não apaga doses, saldo ou trilha; confirmação direta também baixa',()=>asUser(1,async()=>{await stock();const r=await routine();await db.query('INSERT INTO public.medication_intakes(user_id,routine_id) VALUES($1,$2)',[id(1),r]);assert.equal(Number(await balance()),8);await assert.rejects(db.query('DELETE FROM public.stock_movements'));}));
test('rotina arquivada preserva tomadas e estoque; bloqueia novas confirmações',()=>asUser(1,async()=>{await stock();const r=await routine();await change(r);await db.query('SELECT public.archive_medication_routine($1)',[r]);assert.equal((await db.query('SELECT count(*)::int AS n FROM public.medication_intakes')).rows[0].n,1);assert.equal(Number(await balance()),8);await assert.rejects(change(r,'confirm',null,'2026-10-23T12:00:00Z'));}));
test('rotinas e tomadas legadas permanecem sem baixa retroativa nem estorno fantasma',()=>asUser(1,async()=>{
 const r=(await db.query(`INSERT INTO public.medication_routines(user_id,name,period_description,has_no_end_date,scheduled_time,deadline_time) VALUES($1,'Legada','Texto antigo',true,'08:00','09:00') RETURNING id`,[id(1)])).rows[0].id;
 await db.query('INSERT INTO public.routine_medications(user_id,routine_id,medication_id) VALUES($1,$2,$3)',[id(1),r,id(11)]);
 const old=(await db.query("INSERT INTO public.medication_intakes(user_id,routine_id,taken_at) VALUES($1,$2,'2026-10-21T12:00:00Z') RETURNING id",[id(1),r])).rows[0];
 await stock();await routine(doses(),r);assert.equal(Number(await balance()),10);
 await change(r,'undo',old.id,'2026-10-21T12:00:00Z');assert.equal(Number(await balance()),10);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.stock_movements WHERE kind=\'reversal\'')).rows[0].n,0);
}));
for(const query of ["UPDATE public.medication_stock SET total_tablets=999", "UPDATE public.medication_routines SET stock_tracking_enabled=false", "UPDATE public.routine_medications SET quantity_per_intake=NULL,quantity_unit=NULL", "DELETE FROM public.routine_medications", "INSERT INTO public.routine_medications(user_id,routine_id,medication_id) SELECT user_id,id,'00000000-0000-4000-8000-000000000012' FROM public.medication_routines"]){
 test(`definição rastreada protegida: ${query.split(' ').slice(0,3).join(' ')}`,()=>assert.rejects(asUser(1,async()=>{await stock();await routine();await db.query(query);})));
}
test('comando de conferência repetido após uma tomada não repõe estoque novamente',()=>asUser(1,async()=>{const key=crypto.randomUUID();const config=()=>db.query('SELECT public.set_medication_inventory($1,10,30,\'tablet\',$2)',[id(11),key]);await config();const r=await routine();await change(r);await config();assert.equal(Number(await balance()),8);}));
test('operação com vários medicamentos baixa e estorna as duas unidades juntas',()=>asUser(1,async()=>{
 await stock(10);await stock(20,'ml',id(12));const r=await routine([...doses(),...doses(2.5,'ml',id(12))]);
 const i=await change(r);assert.equal(Number(await balance()),8);assert.equal(Number(await balance(id(12))),17.5);
 await change(r,'undo',i.id);assert.equal(Number(await balance()),10);assert.equal(Number(await balance(id(12))),20);
}));
test('data local próxima da meia-noite impede confirmação duplicada',()=>asUser(1,async()=>{await stock();const r=await routine();await change(r,'confirm',null,'2026-10-22T02:30:00Z');await change(r,'confirm',null,'2026-10-22T02:50:00Z');assert.equal(Number(await balance()),8);await change(r,'confirm',null,'2026-10-22T03:05:00Z');assert.equal(Number(await balance()),6);}));
test('consumo de medicamento sem saldo declarado mantém a quantidade desconhecida',()=>asUser(1,async()=>{
 await stock();await stock(null,'ml',id(12));const r=await routine([...doses(),...doses(999999999.999,'ml',id(12))]);
 const i=await change(r);assert.equal(Number(await balance()),8);
 // A quantidade desconhecida não é assumida como zero; confirme o saldo físico.
 await change(r,'undo',i.id);assert.equal(Number(await balance()),10);
}));
test('falha na segunda baixa cancela também a primeira e não deixa tomada parcial',()=>asUser(1,async()=>{
 await stock();await stock(0,'ml',id(12));const r=await routine([...doses(),...doses(999999999.999,'ml',id(12))]);await change(r);
 await db.exec('SAVEPOINT before_failure');await assert.rejects(change(r,'confirm',null,'2026-10-23T12:00:00Z'),{code:'23514'});await db.exec('ROLLBACK TO SAVEPOINT before_failure');
 assert.equal(Number(await balance()),8);assert.equal((await db.query('SELECT count(*)::int n FROM public.medication_intakes')).rows[0].n,1);
}));
test('repetição de salvar rotina não cria outra rotina nem duplica consumo diário',()=>asUser(1,async()=>{
 const def={...definition,command_id:crypto.randomUUID()};const save=()=>db.query('SELECT public.save_routine_with_doses(NULL,$1,$2) AS id',[def,doses()]);const a=(await save()).rows[0].id;assert.equal((await save()).rows[0].id,a);assert.equal(Number((await summary()).daily_quantity),2);
}));

test('constraint não aceita pares incompletos de dose mesmo em escrita administrativa',async()=>{await db.exec('BEGIN');try{await assert.rejects(db.query("INSERT INTO public.routine_medications(user_id,routine_id,medication_id,quantity_per_intake,quantity_unit) VALUES($1,$2,$3,2,NULL)",[id(1),id(80),id(11)]),{code:'23514'});}finally{await db.exec('ROLLBACK');}});
