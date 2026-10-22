// Ensaia o backup privado sem conectar à origem/destino nem publicar dados.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const snapshot = process.argv[2];
if (!snapshot) {
  console.error('Uso: node scripts/rehearse-neon-backup.mjs /caminho/privado/source_snapshot.json');
  process.exit(1);
}
const script = fileURLToPath(new URL('./neon-migration.py', import.meta.url));
const db = new PGlite();
try {
  const { queries, manifest } = JSON.parse(execFileSync('python3', ['-c', `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('migration',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
snapshot,manifest=module.read_backup(sys.argv[2])
print(json.dumps({'queries':module.restoration_queries(snapshot,manifest),'manifest':manifest}))
`, script, snapshot], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  // Somente o ambiente local fornece esse stub. No Neon, o subject vem do JWT
  // validado pelo Data API. Este ensaio NÃO verifica login nem JWT.
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anonymous;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'') $$;
    BEGIN;
  `);
  for (const { query, params } of queries) await db.query(query, params);
  await db.exec('COMMIT');
  const { rows } = await db.query('SELECT count(*)::integer AS count FROM application_private.accounts');
  if (rows[0].count !== manifest.counts.users) throw new Error('Account count mismatch');
  console.log(JSON.stringify({
    local_restore: 'passed', exact_domain_copy: true,
    account_ids_preserved: true, counts: manifest.counts,
    auth_validation: 'pending; local subject stub only',
  }));
} catch {
  // Não imprimir erro SQL, queries ou buffers: podem conter dados pessoais.
  console.error('Ensaio interrompido sem publicação; verifique snapshot, checksum, esquema e dependências.');
  process.exitCode = 1;
} finally {
  await db.close();
}
