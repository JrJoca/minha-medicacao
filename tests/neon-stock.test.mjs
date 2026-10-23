import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stockSql = readFileSync(new URL('../neon/migrations/202610220003_medication_stock.sql', import.meta.url), 'utf8');
const coreSql = readFileSync(new URL('../neon/migrations/202610210001_medication_core.sql', import.meta.url), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth;
    CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('fixture.subject',true),'') $$;`);
  await db.exec(coreSql);
  for (const [n, role, owner] of [[1,'owner',null],[2,'viewer',id(1)],[3,'owner',null],[4,'owner',null]]) {
    await db.query(`INSERT INTO application_private.accounts(id,auth_subject,source_email,access_role,owner_user_id,created_at,updated_at,is_active)
      VALUES($1,$2,$3,$4,$5,now(),now(),$6)`, [id(n),id(100+n),`fixture-${n}@example.invalid`,role,owner,n!==4]);
  }
  for (const n of [1,3,4]) await db.query('INSERT INTO public.medications(id,user_id,name,dosage) VALUES($1,$2,$3,$4)',[id(10+n),id(n),`Fixture ${n}`,'500 mg']);
  await db.exec(stockSql);
});
after(async () => { await db?.close(); });

async function asUser(n, run, role='authenticated') {
  await db.exec('BEGIN');
  try {
    await db.query("SELECT set_config('fixture.subject',$1,true)",[n===null?'':id(100+n)]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    return await run();
  } finally { await db.exec('ROLLBACK'); }
}

async function configure(values={}) {
  const {total=10,box=30,daily=2,medication=id(11),owner=id(1)}=values;
  return db.query(`INSERT INTO public.medication_stock(medication_id,user_id,total_tablets,tablets_per_box,tablets_per_day)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[medication,owner,total,box,daily]);
}

test('legados continuam sem estoque e sem dose inferida da dosagem textual', async () => {
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.medication_stock')).rows[0].n,0);
  await asUser(1,async()=>{
    const {rows}=await db.query('SELECT * FROM public.medication_stock_summary()');
    assert.deepEqual(rows,[{medication_id:id(11),user_id:id(1),total_tablets:null,tablets_per_box:null,tablets_per_day:null,estimated_days:null,full_days_covered:null}]);
  });
});

test('10 comprimidos a 2 por dia duram 5 dias, independentemente do tamanho da caixa', async () => {
  await asUser(1,async()=>{
    const {rows}=await configure();
    assert.equal(Number(rows[0].estimated_days),5);
    assert.equal(rows[0].full_days_covered,5);
    await db.query('UPDATE public.medication_stock SET tablets_per_box=60');
    assert.equal(Number((await db.query('SELECT estimated_days FROM public.medication_stock')).rows[0].estimated_days),5);
  });
});

test('10 a 3 por dia distinguem duração proporcional de 3 dias completos', async () => {
  await asUser(1,async()=>{
    const {rows}=await configure({daily:3});
    assert.ok(Math.abs(Number(rows[0].estimated_days)-10/3)<1e-10);
    assert.equal(rows[0].full_days_covered,3);
  });
});

test('zero informado gera zero dias; ausência de saldo ou consumo não gera previsão', async () => {
  for (const [total,daily,expected] of [[0,2,0],[null,2,null],[10,null,null],[null,null,null]]) {
    await asUser(1,async()=>{
      const {rows}=await configure({total,daily});
      assert.equal(rows[0].estimated_days===null?null:Number(rows[0].estimated_days),expected);
    });
  }
});

test('saldo negativo, caixa inválida e consumo zero/negativo são recusados', async () => {
  for (const values of [{total:-1},{box:0},{box:-1},{daily:0},{daily:-1}]) {
    await assert.rejects(asUser(1,()=>configure(values)),{code:'23514'});
  }
});

test('mudança de saldo/consumo recalcula previsão e impede alteração direta do resultado', async () => {
  await asUser(1,async()=>{
    await configure();
    await db.query('UPDATE public.medication_stock SET total_tablets=20,tablets_per_day=4');
    assert.equal(Number((await db.query('SELECT estimated_days FROM public.medication_stock')).rows[0].estimated_days),5);
  });
  await assert.rejects(asUser(1,async()=>{await configure();await db.query('UPDATE public.medication_stock SET estimated_days=999');}),{code:'428C9'});
});

test('um único estoque por medicamento e FK composta impedem duplicata e troca de dono', async () => {
  await assert.rejects(asUser(1,async()=>{await configure();await configure();}),{code:'23505'});
  await assert.rejects(asUser(1,()=>configure({medication:id(13)})),{code:'23503'});
  await assert.rejects(asUser(1,()=>configure({owner:id(3)})),{code:'42501'});
});

test('viewer lê somente o proprietário vinculado e não cria, atualiza ou remove estoque', async () => {
  await db.exec('BEGIN');
  await configure();
  await configure({medication:id(13),owner:id(3)});
  await db.exec('COMMIT');
  try {
    await asUser(2,async()=>{
      assert.deepEqual((await db.query('SELECT medication_id FROM public.medication_stock')).rows,[{medication_id:id(11)}]);
      assert.equal((await db.query('UPDATE public.medication_stock SET total_tablets=999 RETURNING medication_id')).rows.length,0);
      assert.equal((await db.query('DELETE FROM public.medication_stock RETURNING medication_id')).rows.length,0);
      assert.equal((await db.query('SELECT * FROM public.medication_stock_summary()')).rows.length,1);
    });
    await assert.rejects(asUser(2,()=>configure({medication:id(12),owner:id(2)})),{code:'42501'});
    await asUser(3,async()=>assert.deepEqual((await db.query('SELECT medication_id FROM public.medication_stock_summary()')).rows,[{medication_id:id(13)}]));
    await asUser(4,async()=>assert.equal((await db.query('SELECT * FROM public.medication_stock_summary()')).rows.length,0));
  } finally {await db.exec('DELETE FROM public.medication_stock');}
});

test('anônimo não acessa tabela/RPC e cliente não acessa o controle privado da migração', async () => {
  for (const query of ['SELECT * FROM public.medication_stock','SELECT * FROM public.medication_stock_summary()']) {
    await assert.rejects(asUser(null,()=>db.query(query),'anonymous'),{code:'42501'});
  }
  await assert.rejects(asUser(1,()=>db.query('SELECT * FROM application_private.schema_migrations')),{code:'42501'});
});

test('RPC de resumo usa permissões do chamador e preserva RLS como invoker', async () => {
  const {rows}=await db.query("SELECT prosecdef FROM pg_proc WHERE oid='public.medication_stock_summary()'::regprocedure");
  assert.equal(rows[0].prosecdef,false);
});

test('atualização preserva created_at e atualiza updated_at no servidor', async () => {
  await asUser(1,async()=>{
    const initial=(await configure()).rows[0];
    const changed=(await db.query("UPDATE public.medication_stock SET total_tablets=11,created_at='2000-01-01',updated_at='2000-01-01' RETURNING *")).rows[0];
    assert.equal(changed.created_at.toISOString(),initial.created_at.toISOString());
    assert.ok(changed.updated_at.getTime()>=initial.updated_at.getTime());
  });
});

test('cadastro antigo continua aceitando somente os campos originais e reaplicação não sobrescreve dados', async () => {
  await asUser(1,async()=>{
    const {rows}=await db.query("INSERT INTO public.medications(user_id,name,dosage) VALUES($1,'Cadastro legado','Texto original') RETURNING id",[id(1)]);
    assert.equal((await db.query('SELECT total_tablets FROM public.medication_stock_summary() WHERE medication_id=$1',[rows[0].id])).rows[0].total_tablets,null);
  });
  await db.exec('BEGIN');
  await assert.rejects(db.exec(stockSql),{code:'42P07'});
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.medications')).rows[0].n,3);
});

const upgradePlan=JSON.parse(execFileSync('python3',['-c',`
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('stock',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps(m.upgrade_queries('synthetic-backup','0'*64)))
`,fileURLToPath(new URL('../scripts/neon-stock-schema.py',import.meta.url))],{encoding:'utf8'}));

async function runPlan(database,plan) {
  await database.exec('BEGIN');
  try {
    for(const {query,params} of plan) await database.query(query,params);
    await database.exec('COMMIT');
  } catch(error) {await database.exec('ROLLBACK');throw error;}
}

async function beforeUpgrade() {
  const database=new PGlite();
  await database.exec('CREATE SCHEMA auth; CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$');
  await database.exec(coreSql);
  await database.query("INSERT INTO application_private.accounts(id,source_email,access_role,created_at,updated_at) VALUES($1,'upgrade@example.invalid','owner',now(),now())",[id(1)]);
  await database.query("INSERT INTO public.medications(id,user_id,name,dosage) VALUES($1,$2,'Preservar','Texto legado')",[id(11),id(1)]);
  return database;
}

test('executor amplia o esquema sem alterar registros e registra versão/checksum/backup',async()=>{
  const isolated=await beforeUpgrade();
  try {
    await runPlan(isolated,upgradePlan);
    assert.equal((await isolated.query('SELECT count(*)::int AS n FROM public.medication_stock')).rows[0].n,0);
    assert.equal((await isolated.query('SELECT dosage FROM public.medications')).rows[0].dosage,'Texto legado');
    const row=(await isolated.query('SELECT version,backup_branch_id FROM application_private.schema_migrations')).rows[0];
    assert.deepEqual(row,{version:'202610220003_medication_stock',backup_branch_id:'synthetic-backup'});
    await assert.rejects(runPlan(isolated,upgradePlan),{code:'22012'});
  } finally {await isolated.close();}
});

test('verificação de preservação reverte toda a ampliação se um registro antigo mudar',async()=>{
  const isolated=await beforeUpgrade();
  const plan=structuredClone(upgradePlan);
  plan.splice(plan.findIndex(q=>q.query.includes('existing_data_preserved')),0,{query:"UPDATE public.medications SET dosage='Alteração indevida'",params:[]});
  try {
    await assert.rejects(runPlan(isolated,plan),{code:'22012'});
    assert.equal((await isolated.query("SELECT to_regclass('public.medication_stock') AS t")).rows[0].t,null);
    assert.equal((await isolated.query('SELECT dosage FROM public.medications')).rows[0].dosage,'Texto legado');
  } finally {await isolated.close();}
});
