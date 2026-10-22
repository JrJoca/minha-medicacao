import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-19T00:00:00+00:00';
const user = (n, metadata = {}) => ({
  id: id(n), email: `fixture-${n}@example.invalid`,
  raw_app_meta_data: metadata, created_at: date, updated_at: date,
});
const medicine = (n, owner) => ({
  id: id(n), user_id: id(owner), name: `Fixture ${n}`, dosage: 'Texto de teste',
  reference_url: null, created_at: date,
});
const snapshot = {
  exported_at: date,
  users: [user(1), user(2, { role: 'viewer', owner_user_id: id(1) }), user(3),
    { ...user(4), deleted_at: date }],
  medications: [medicine(11, 1), medicine(13, 3), medicine(14, 4)],
  medication_routines: [{
    id: id(21), user_id: id(1), name: 'Rotina sintética', period_description: 'Diária',
    has_no_end_date: true, duration_value: null, duration_unit: null, current_day: 1,
    total_days: null, scheduled_time: '08:00:00', deadline_time: '09:00:00',
    reminders_enabled: true, status: 'active', created_at: date, updated_at: date,
  }],
  routine_medications: [{ user_id: id(1), routine_id: id(21), medication_id: id(11), created_at: date }],
  medication_intakes: [{ id: id(31), user_id: id(1), routine_id: id(21), taken_at: date, created_at: date }],
};
const script = fileURLToPath(new URL('../scripts/neon-migration.py', import.meta.url));
const queries = JSON.parse(execFileSync('python3', ['-c', `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('migration',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
snapshot=json.load(sys.stdin);module.validate_snapshot(snapshot)
print(json.dumps(module.restoration_queries(snapshot,{'sha256':'0'*64,'source_project':'a'*20,'exported_at':snapshot['exported_at']})))
`, script], { input: JSON.stringify(snapshot), encoding: 'utf8' }));

async function bootstrap(database) {
  // Somente o harness simula o subject de um JWT já validado.
  // Não é um teste da validação criptográfica do serviço Neon Auth.
  await database.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anonymous;
    CREATE SCHEMA auth;
    CREATE SCHEMA neon_auth;
    CREATE TABLE neon_auth."user" (
      id uuid PRIMARY KEY, email text NOT NULL, "emailVerified" boolean,
      banned boolean
    );
    CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'') $$;
  `);
}

async function importSnapshot(database, plan = queries) {
  await database.exec('BEGIN');
  try {
    for (const { query, params } of plan) await database.query(query, params);
    await database.exec('COMMIT');
  } catch (error) {
    await database.exec('ROLLBACK');
    throw error;
  }
}

function transitionPlan(mapping, bind) {
  return JSON.parse(execFileSync('python3', ['-c', `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('migration',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(json.dumps(m.account_transition_queries(json.load(sys.stdin),sys.argv[2]=='bind')))
`, script, bind ? 'bind' : 'reserve'], { input: JSON.stringify(mapping), encoding: 'utf8' }));
}

let db;
before(async () => {
  db = new PGlite();
  await bootstrap(db);
  await importSnapshot(db);
  for (const n of [1, 2, 3, 4]) {
    await db.query('UPDATE application_private.accounts SET auth_subject=$1 WHERE id=$2', [id(100 + n), id(n)]);
  }
});
after(async () => { await db?.close(); });

async function asUser(n, run, role = 'authenticated') {
  await db.exec('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [n === null ? '' : id(100 + n)]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    return await run();
  } finally {
    await db.exec('ROLLBACK');
  }
}

test('cópia preserva colunas, IDs, textos, datas e vínculos do snapshot', async () => {
  for (const [table, rows] of Object.entries(snapshot)) {
    if (table === 'users' || table === 'exported_at') continue;
    const result = await db.query(`SELECT count(*)::integer AS count FROM public.${table}`);
    assert.equal(result.rows[0].count, rows.length);
  }
  const policies = await db.query("SELECT count(*)::integer AS count FROM pg_policies WHERE schemaname='public'");
  assert.equal(policies.rows[0].count, 16);
});

test('contexto resolve novo subject para o ID antigo e papel protegido', async () => {
  await asUser(2, async () => {
    const { rows } = await db.query('SELECT * FROM public.application_context()');
    assert.deepEqual(rows, [{ user_id: id(2), role: 'viewer', owner_user_id: id(1) }]);
  });
});

test('proprietário lê e altera somente seus registros', async () => {
  await asUser(1, async () => {
    const { rows } = await db.query('SELECT id FROM public.medications');
    assert.deepEqual(rows, [{ id: id(11) }]);
    const changed = await db.query('UPDATE public.medications SET dosage=$1 WHERE id=$2 RETURNING id', ['Revisão sintética', id(11)]);
    assert.equal(changed.rows.length, 1);
    const foreign = await db.query('UPDATE public.medications SET dosage=$1 WHERE id=$2 RETURNING id', ['Tentativa', id(13)]);
    assert.equal(foreign.rows.length, 0);
  });
});

test('visualizador lê somente o proprietário vinculado e não atualiza/exclui', async () => {
  await asUser(2, async () => {
    assert.deepEqual((await db.query('SELECT id FROM public.medications')).rows, [{ id: id(11) }]);
    assert.equal((await db.query('UPDATE public.medications SET dosage=$1 RETURNING id', ['Tentativa'])).rows.length, 0);
    assert.equal((await db.query('DELETE FROM public.medications RETURNING id')).rows.length, 0);
  });
});

test('visualizador não insere nem usando seu próprio ID', async () => {
  await assert.rejects(asUser(2, () => db.query('INSERT INTO public.medications(user_id,name,dosage) VALUES($1,$2,$3)', [id(2), 'Teste', 'Teste'])), { code: '42501' });
});

test('outro usuário não acessa dados do primeiro proprietário', async () => {
  await asUser(3, async () => {
    assert.deepEqual((await db.query('SELECT id FROM public.medications')).rows, [{ id: id(13) }]);
    assert.equal((await db.query('SELECT * FROM public.medication_intakes')).rows.length, 0);
  });
});

test('anônimo não lê dados nem chama o contexto de conta', async () => {
  await assert.rejects(asUser(null, () => db.query('SELECT * FROM public.medications'), 'anonymous'), { code: '42501' });
  await assert.rejects(asUser(null, () => db.query('SELECT * FROM public.application_context()'), 'anonymous'), { code: '42501' });
});

test('metadados arbitrários não promovem visualizador a proprietário', async () => {
  await asUser(2, async () => {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ app_metadata: { role: 'owner' }, user_metadata: { role: 'owner' } })]);
    assert.equal((await db.query('UPDATE public.medications SET dosage=$1 RETURNING id', ['Tentativa'])).rows.length, 0);
  });
  await assert.rejects(asUser(2, () => db.query("UPDATE application_private.accounts SET access_role='owner'")), { code: '42501' });
});

test('FK composta impede vínculo entre proprietários distintos', async () => {
  await assert.rejects(asUser(1, () => db.query('INSERT INTO public.routine_medications(user_id,routine_id,medication_id) VALUES($1,$2,$3)', [id(1), id(21), id(13)])), { code: '23503' });
});

test('conta desativada não ganha acesso após a migração', async () => {
  await asUser(4, async () => {
    assert.equal((await db.query('SELECT * FROM public.application_context()')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM public.medications')).rows.length, 0);
  });
});

test('cadastro novo usa e-mail verificado canônico e cria escopo próprio', async () => {
  await db.query('INSERT INTO neon_auth."user" VALUES ($1,$2,true,false)', [id(105), 'new@example.invalid']);
  await asUser(5, async () => {
    const first = (await db.query('SELECT * FROM public.register_application_account()')).rows[0];
    assert.equal(first.role, 'owner');
    assert.equal(first.owner_user_id, null);
    assert.notEqual(first.user_id, id(105));
    assert.equal((await db.query('SELECT * FROM public.medications')).rows.length, 0);
    await db.query('INSERT INTO public.medications(user_id,name,dosage) VALUES($1,$2,$3)', [first.user_id, 'Nova conta', 'Teste']);
    assert.equal((await db.query('SELECT * FROM public.medications')).rows.length, 1);
    const second = (await db.query('SELECT * FROM public.register_application_account()')).rows[0];
    assert.equal(first.user_id, second.user_id);
  });
});

test('cadastro recusa e-mail não verificado e conta banida no serviço canônico', async () => {
  await db.query('INSERT INTO neon_auth."user" VALUES ($1,$2,false,false),($3,$4,true,true)', [id(106), 'unverified@example.invalid', id(107), 'banned@example.invalid']);
  for (const n of [6, 7]) {
    await assert.rejects(asUser(n, () => db.query('SELECT * FROM public.register_application_account()')), { code: '42501' });
  }
});

test('e-mail de origem não vincula outra identidade automaticamente', async () => {
  await db.query('INSERT INTO neon_auth."user" VALUES ($1,$2,true,false)', [id(108), snapshot.users[0].email]);
  await assert.rejects(asUser(8, () => db.query('SELECT * FROM public.register_application_account()')), { code: '42501' });
});

test('novo e-mail reservado para visualizador não ganha uma conta proprietária', async () => {
  await db.query('INSERT INTO application_private.login_reservations VALUES ($1,$2)', [id(2), 'viewer-new@example.invalid']);
  await db.query('INSERT INTO neon_auth."user" VALUES ($1,$2,true,false)', [id(109), 'viewer-new@example.invalid']);
  await assert.rejects(asUser(9, () => db.query('SELECT * FROM public.register_application_account()')), { code: '42501' });
  await assert.rejects(asUser(2, () => db.query('DELETE FROM application_private.login_reservations')), { code: '42501' });
});

test('cadastro não reativa conta desativada nem permite acesso anônimo', async () => {
  await asUser(4, async () => {
    assert.equal((await db.query('SELECT * FROM public.register_application_account()')).rows.length, 0);
  });
  await assert.rejects(asUser(null, () => db.query('SELECT * FROM public.register_application_account()'), 'anonymous'), { code: '42501' });
});

function cutoverPlan(fixture) {
  return JSON.parse(execFileSync('python3', ['-c', `
import importlib.util,json,sys,hashlib
spec=importlib.util.spec_from_file_location('cutover',sys.argv[1])
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
s=json.load(sys.stdin);raw=json.dumps(s).encode();m={'source_project':c.SOURCE,'exported_at':s['exported_at'],'sha256':hashlib.sha256(raw).hexdigest(),'counts':c.migration.validate_snapshot(s)}
mapping={'accounts':[{'legacy_id':u['id'],'role':(u.get('raw_app_meta_data') or {}).get('role','owner'),'login_email':u['email']} for u in s['users']]}
print(json.dumps(c.preparation_queries(s,m,raw,mapping)))
`, fileURLToPath(new URL('../scripts/neon-cutover.py', import.meta.url))], { input: JSON.stringify(fixture), encoding: 'utf8' }));
}

test('preparação do corte conserva backup completo e mantém destino fechado para escrita', async () => {
  const isolated = new PGlite();
  try {
    await bootstrap(isolated);
    const fixture = structuredClone(snapshot);
    fixture.users[0].encrypted_password = 'hash-exclusivamente-sintetico';
    await importSnapshot(isolated, cutoverPlan(fixture));
    const archived = await isolated.query("SELECT convert_from(snapshot_bytes,'UTF8')::jsonb AS snapshot FROM application_private.source_backups");
    assert.deepEqual(archived.rows[0].snapshot, fixture);
    assert.equal((await isolated.query('SELECT phase FROM application_private.cutover_control')).rows[0].phase, 'prepared');
    await isolated.exec('SET ROLE authenticated');
    await assert.rejects(isolated.query('SELECT snapshot_bytes FROM application_private.source_backups'), { code: '42501' });
    await assert.rejects(isolated.query('SELECT * FROM public.register_application_account()'), { code: '42501' });
    await assert.rejects(isolated.query('INSERT INTO public.medications(user_id,name,dosage) VALUES($1,$2,$3)', [id(1), 'Tentativa', 'Teste']), { code: '42501' });
    await isolated.exec('RESET ROLE');
    const authUsers = await isolated.query('SELECT * FROM neon_auth."user"');
    assert.equal(authUsers.rows.length, 0);
  } finally {
    await isolated.close();
  }
});

test('preparador recusa destino com dados existentes antes de alterar qualquer tabela', async () => {
  const isolated = new PGlite();
  try {
    await bootstrap(isolated);
    await isolated.exec('CREATE TABLE public.existing_data(value text); INSERT INTO public.existing_data VALUES (\'Preservar\')');
    await assert.rejects(importSnapshot(isolated, cutoverPlan(snapshot)), { code: '22012' });
    assert.equal((await isolated.query('SELECT value FROM public.existing_data')).rows[0].value, 'Preservar');
    assert.equal((await isolated.query("SELECT to_regnamespace('application_private') AS schema")).rows[0].schema, null);
  } finally {
    await isolated.close();
  }
});

test('vinculação administrativa exige ambas as identidades verificadas e conserva papéis/IDs', async () => {
  const isolated = new PGlite();
  const mapping = { accounts: [
    { legacy_id: id(1), role: 'owner', login_email: 'owner-new@example.invalid' },
    { legacy_id: id(2), role: 'viewer', login_email: 'viewer-new@example.invalid' },
  ] };
  try {
    await bootstrap(isolated);
    await importSnapshot(isolated);
    const wrong = structuredClone(mapping);
    wrong.accounts[1].role = 'owner';
    await assert.rejects(importSnapshot(isolated, transitionPlan(wrong, false)), { code: '22012' });
    assert.equal((await isolated.query('SELECT * FROM application_private.login_reservations')).rows.length, 0);
    await importSnapshot(isolated, transitionPlan(mapping, false));
    await isolated.query('INSERT INTO neon_auth."user" VALUES ($1,$2,true,false),($3,$4,false,false)', [id(101), mapping.accounts[0].login_email, id(102), mapping.accounts[1].login_email]);
    await assert.rejects(importSnapshot(isolated, transitionPlan(mapping, true)), { code: '22012' });
    assert.equal((await isolated.query('SELECT * FROM application_private.accounts WHERE auth_subject IS NOT NULL')).rows.length, 0);
    await isolated.query('UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=$1', [id(102)]);
    await importSnapshot(isolated, transitionPlan(mapping, true));
    const linked = (await isolated.query('SELECT id,auth_subject,access_role,owner_user_id,source_email FROM application_private.accounts WHERE id IN ($1,$2) ORDER BY id', [id(1), id(2)])).rows;
    assert.deepEqual(linked, [
      { id: id(1), auth_subject: id(101), access_role: 'owner', owner_user_id: null, source_email: snapshot.users[0].email },
      { id: id(2), auth_subject: id(102), access_role: 'viewer', owner_user_id: id(1), source_email: snapshot.users[1].email },
    ]);
    await assert.rejects(importSnapshot(isolated, transitionPlan(mapping, true)), { code: '22012' });
  } finally {
    await isolated.close();
  }
});

test('reaplicação falha sem sobrescrever dados já presentes', async () => {
  await assert.rejects(importSnapshot(db), { code: '42P06' });
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.medications')).rows[0].count, 3);
});

test('divergência na cópia reverte esquema e dados na mesma transação', async () => {
  const isolated = new PGlite();
  try {
    await bootstrap(isolated);
    const badPlan = structuredClone(queries);
    badPlan.find((q) => q.query.includes('exact_copy')).params = ['[]'];
    await assert.rejects(importSnapshot(isolated, badPlan), { code: '22012' });
    assert.equal((await isolated.query("SELECT to_regclass('public.medications') AS table_name")).rows[0].table_name, null);
  } finally {
    await isolated.close();
  }
});

test('importa sem serviço de login e nega acesso até existir o helper oficial', async () => {
  const isolated = new PGlite();
  try {
    await importSnapshot(isolated);
    await isolated.query('UPDATE application_private.accounts SET auth_subject=$1 WHERE id=$2', [id(101), id(1)]);
    await isolated.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id(101)]);
    await isolated.exec('SET ROLE authenticated');
    assert.equal((await isolated.query('SELECT * FROM public.application_context()')).rows.length, 0);
    assert.equal((await isolated.query('SELECT * FROM public.medications')).rows.length, 0);
    await isolated.exec('RESET ROLE');
    await isolated.exec(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'') $$;
      SET ROLE authenticated;
    `);
    assert.deepEqual((await isolated.query('SELECT * FROM public.application_context()')).rows,
      [{ user_id: id(1), role: 'owner', owner_user_id: null }]);
    assert.deepEqual((await isolated.query('SELECT id FROM public.medications')).rows, [{ id: id(11) }]);
  } finally {
    await isolated.close();
  }
});

test('recusa roles de API preexistentes que possam contornar o RLS', async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec('CREATE ROLE authenticated BYPASSRLS');
    await assert.rejects(importSnapshot(isolated), { code: 'P0001' });
    assert.equal((await isolated.query("SELECT to_regclass('public.medications') AS table_name")).rows[0].table_name, null);
  } finally {
    await isolated.close();
  }
});

const cutoverScript = fileURLToPath(new URL('../scripts/neon-cutover.py', import.meta.url));
const frozenAt = '2026-10-21T00:00:00+00:00';
function finalPlan(previous, final, operation = 'finalize') {
  return JSON.parse(execFileSync('python3', ['-c', `
import importlib.util,json,sys,hashlib
spec=importlib.util.spec_from_file_location('c',sys.argv[1]);c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
p,s=json.load(sys.stdin)
def manifest(s):
 raw=json.dumps(s).encode()
 return raw,{'source_project':c.SOURCE,'exported_at':s['exported_at'],'sha256':hashlib.sha256(raw).hexdigest(),'counts':c.migration.validate_snapshot(s)}
_,pm=manifest(p);raw,m=manifest(s)
mapping={'accounts':[{'legacy_id':u['id'],'role':(u.get('raw_app_meta_data') or {}).get('role','owner'),'login_email':u['email']} for u in s['users']]}
if sys.argv[2]=='finalize': plan=c.finalization_queries(p,pm,s,m,raw,mapping,sys.argv[3])
else: plan=c.activation_queries(m['sha256'],sys.argv[3],'a'*40)
print(json.dumps(plan))
`, cutoverScript, operation, frozenAt], { input: JSON.stringify([previous, final]), encoding: 'utf8' }));
}

function finalFixtures() {
  const previous = structuredClone(snapshot);
  previous.users = previous.users.slice(0, 2);
  previous.medications = previous.medications.slice(0, 1);
  const final = structuredClone(previous);
  final.exported_at = '2026-10-22T00:00:00+00:00';
  final.medications[0].dosage = 'Alteração entre preparação e corte';
  final.medications.push(medicine(12, 1));
  final.medication_intakes.push({ ...final.medication_intakes[0], id: id(32), taken_at: final.exported_at });
  return [previous, final];
}

async function verifiedPrepared(database, fixture) {
  await bootstrap(database);
  await importSnapshot(database, cutoverPlan(fixture));
  for (const n of [1, 2]) await database.query('INSERT INTO neon_auth."user" VALUES($1,$2,true,false)', [id(100 + n), fixture.users[n - 1].email]);
}

test('barreira bloqueia todas as mutações, mantém leitura e pode ser revertida antes da ativação', async () => {
  const isolated = new PGlite();
  try {
    await bootstrap(isolated);
    await importSnapshot(isolated);
    await isolated.exec("CREATE TABLE unrelated_data(value text); INSERT INTO unrelated_data VALUES('Preservar')");
    await isolated.exec(readFileSync(new URL('../neon/cutover/freeze-supabase.sql', import.meta.url), 'utf8'));
    for (const table of ['medications', 'medication_routines', 'routine_medications', 'medication_intakes']) {
      for (const sql of [`DELETE FROM public.${table}`, `UPDATE public.${table} SET user_id=user_id`, `INSERT INTO public.${table} SELECT * FROM public.${table} WHERE false`, `TRUNCATE public.${table} CASCADE`]) {
        await assert.rejects(isolated.exec(sql), { code: '55000' });
      }
    }
    assert.equal((await isolated.query('SELECT count(*)::integer AS n FROM public.medications')).rows[0].n, 3);
    assert.deepEqual((await isolated.query('SELECT * FROM unrelated_data')).rows, [{ value: 'Preservar' }]);
    await isolated.exec(readFileSync(new URL('../neon/cutover/unfreeze-supabase.sql', import.meta.url), 'utf8'));
    await isolated.exec('UPDATE public.medications SET dosage=dosage');
    assert.equal((await isolated.query("SELECT to_regnamespace('medication_cutover_private') AS s")).rows[0].s, null);
  } finally { await isolated.close(); }
});

test('sincronização final preserva deltas, liga logins e só abre escritas na ativação', async () => {
  const isolated = new PGlite();
  const [previous, final] = finalFixtures();
  try {
    await verifiedPrepared(isolated, previous);
    await importSnapshot(isolated, finalPlan(previous, final));
    const state = (await isolated.query('SELECT phase FROM application_private.cutover_control')).rows[0];
    assert.equal(state.phase, 'prepared');
    assert.equal((await isolated.query('SELECT count(*)::integer AS n FROM application_private.source_backups')).rows[0].n, 2);
    assert.equal((await isolated.query('SELECT count(*)::integer AS n FROM public.medication_intakes')).rows[0].n, 2);
    await isolated.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id(101)]);
    await isolated.exec('SET ROLE authenticated');
    assert.equal((await isolated.query('SELECT * FROM public.application_context()')).rows[0].user_id, id(1));
    await assert.rejects(isolated.exec('UPDATE public.medications SET dosage=dosage'), { code: '42501' });
    await isolated.exec('RESET ROLE');
    await importSnapshot(isolated, finalPlan(previous, final, 'activate'));
    assert.equal((await isolated.query('SELECT phase FROM application_private.cutover_control')).rows[0].phase, 'active');
    await isolated.exec('SET ROLE authenticated');
    assert.equal((await isolated.query('UPDATE public.medications SET dosage=dosage RETURNING id')).rows.length, 2);
    await isolated.exec('RESET ROLE');
    await isolated.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id(102)]);
    await isolated.exec('SET ROLE authenticated');
    assert.equal((await isolated.query('SELECT * FROM public.application_context()')).rows[0].role, 'viewer');
    assert.equal((await isolated.query('UPDATE public.medications SET dosage=dosage RETURNING id')).rows.length, 0);
    await isolated.exec('RESET ROLE');
    await assert.rejects(importSnapshot(isolated, finalPlan(previous, final, 'activate')), { code: '22012' });
  } finally { await isolated.close(); }
});

test('divergência no destino preparado impede sincronização sem apagar registros', async () => {
  const isolated = new PGlite();
  const [previous, final] = finalFixtures();
  try {
    await verifiedPrepared(isolated, previous);
    await isolated.query('UPDATE public.medications SET dosage=$1', ['Alteração inesperada no destino']);
    await assert.rejects(importSnapshot(isolated, finalPlan(previous, final)), { code: '22012' });
    assert.equal((await isolated.query('SELECT dosage FROM public.medications')).rows[0].dosage, 'Alteração inesperada no destino');
    assert.equal((await isolated.query('SELECT count(*)::integer AS n FROM application_private.accounts WHERE auth_subject IS NOT NULL')).rows[0].n, 0);
  } finally { await isolated.close(); }
});

test('ativação reverte grants se encontrar divergência na cópia final', async () => {
  const isolated = new PGlite();
  const [previous, final] = finalFixtures();
  try {
    await verifiedPrepared(isolated, previous);
    await importSnapshot(isolated, finalPlan(previous, final));
    await isolated.exec('DELETE FROM public.medication_intakes');
    await assert.rejects(importSnapshot(isolated, finalPlan(previous, final, 'activate')), { code: '22012' });
    assert.equal((await isolated.query("SELECT has_table_privilege('authenticated','public.medications','INSERT') AS allowed")).rows[0].allowed, false);
    assert.equal((await isolated.query('SELECT phase FROM application_private.cutover_control')).rows[0].phase, 'prepared');
  } finally { await isolated.close(); }
});
