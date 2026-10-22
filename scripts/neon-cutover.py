#!/usr/bin/env python3
"""Corte autorizado com backup, barreira na origem e ativação transacional."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime

spec = importlib.util.spec_from_file_location("migration", Path(__file__).with_name("neon-migration.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

PROJECT = "floral-pond-94925356"
BRANCH = "br-muddy-term-b5xvw6i7"
SOURCE = "llftfgtswvmwtbmkegpd"
DATABASE = "neondb"


def connection(project, branch, authorized):
    if not authorized:
        raise ValueError("Produção exige --production-authorized após autorização do usuário")
    if (project, branch) != (PROJECT, BRANCH):
        raise ValueError("Destino diferente do projeto/branch autorizado para este corte")
    for variable, expected in (("NEON_PROJECT_ID", project), ("NEON_BRANCH_ID", branch)):
        if os.environ.get(variable, expected) != expected:
            raise ValueError("Identificadores configurados no ambiente divergem do destino autorizado")
    metadata = migration.api("neon", f"/projects/{project}/branches/{branch}")["branch"]
    if metadata.get("id") != branch or not metadata.get("default") or metadata.get("name") != "production":
        raise ValueError("A branch padrão de produção mudou; revisar o destino")
    args = urllib.parse.urlencode({"branch_id": branch, "database_name": DATABASE, "role_name": "neondb_owner", "pooled": "false"})
    uri = migration.api("neon", f"/projects/{project}/connection_uri?{args}")["uri"]
    parsed = urllib.parse.urlsplit(uri)
    if parsed.path != "/" + DATABASE:
        raise ValueError("Banco retornado pela conexão diverge do destino autorizado")
    host = parsed.hostname
    endpoints = migration.api("neon", f"/projects/{project}/endpoints")["endpoints"]
    if not any(e["host"] == host and e["branch_id"] == branch and e["type"] == "read_write" for e in endpoints):
        raise ValueError("Host/conexão não corresponde ao destino confirmado")
    return host, uri


def execute(project, branch, authorized, queries):
    host, uri = connection(project, branch, authorized)
    return migration.request_json("https://" + host + "/sql", {"queries": queries}, {
        "Neon-Connection-String": uri, "Neon-Batch-Isolation-Level": "Serializable",
    })


def read_mapping(path):
    path = Path(path).resolve()
    if path.is_relative_to(migration.CHECKOUT) or path.stat().st_mode & 0o077:
        raise ValueError("Mapeamento deve ficar fora do Git, com permissão 0600")
    mapping = json.loads(path.read_text())
    migration.validate_account_mapping(mapping)
    return mapping


def preparation_queries(snapshot, manifest, raw_snapshot, mapping):
    if manifest["source_project"] != SOURCE:
        raise ValueError("Snapshot pertence a outro projeto de origem")
    if hashlib.sha256(raw_snapshot).hexdigest() != manifest["sha256"] or json.loads(raw_snapshot) != snapshot:
        raise ValueError("Conteúdo do snapshot diverge do manifesto")
    rows = migration.validate_account_mapping(mapping)
    expected = {u["id"]: (u.get("raw_app_meta_data") or {}).get("role", "owner") for u in snapshot["users"]}
    if {r["legacy_id"]: r["role"] for r in rows} != expected:
        raise ValueError("Mapeamento não corresponde a todos os IDs/papéis do snapshot")
    queries = [{"query": """SELECT 1 / (
      to_regnamespace('application_private') IS NULL
      AND NOT EXISTS (SELECT FROM pg_tables WHERE schemaname='public')
      AND to_regprocedure('auth.user_id()') IS NOT NULL
      AND NOT EXISTS (SELECT FROM neon_auth."user")
      )::integer AS empty_official_target""", "params": []}]
    queries += migration.restoration_queries(snapshot, manifest)
    ddl = migration.CHECKOUT / "neon/migrations/202610220001_cutover_preparation.sql"
    queries += [{"query": s, "params": []} for s in migration.split_sql(ddl.read_text())]
    queries += [
        {"query": "INSERT INTO application_private.source_backups(snapshot_sha256,source_project,exported_at,counts,snapshot_bytes) VALUES($1,$2,$3,$4::jsonb,decode($5,'base64'))", "params": [manifest["sha256"], SOURCE, manifest["exported_at"], json.dumps(manifest["counts"]), base64.b64encode(raw_snapshot).decode()]},
        {"query": "INSERT INTO application_private.cutover_control(singleton,phase,snapshot_sha256) VALUES(true,'prepared',$1)", "params": [manifest["sha256"]]},
        {"query": "INSERT INTO application_private.login_reservations(account_id,email) SELECT legacy_id,login_email FROM jsonb_to_recordset($1::jsonb) AS m(legacy_id uuid,role text,login_email text)", "params": [json.dumps(rows)]},
    ]
    # Permite a preparação das senhas sem aceitar escritas em dois bancos.
    for table in migration.TABLES:
        queries.append({"query": f"REVOKE INSERT,UPDATE,DELETE ON public.{table} FROM authenticated", "params": []})
    queries.append({"query": "REVOKE EXECUTE ON FUNCTION public.register_application_account() FROM authenticated", "params": []})
    return queries


def verify_archive(project, branch, authorized, expected_sha):
    result = execute(project, branch, authorized, [{"query": "SELECT snapshot_sha256,source_project,exported_at,counts,encode(snapshot_bytes,'base64') AS content FROM application_private.source_backups WHERE snapshot_sha256=$1", "params": [expected_sha]}])
    rows = result["results"][0]["rows"]
    if len(rows) != 1:
        raise ValueError("Backup remoto ausente ou ambíguo")
    record = rows[0]
    raw = base64.b64decode(record["content"])
    if hashlib.sha256(raw).hexdigest() != expected_sha or record["source_project"] != SOURCE:
        raise ValueError("Checksum/origem do backup remoto não confere")
    counts = migration.validate_snapshot(json.loads(raw))
    if counts != record["counts"]:
        raise ValueError("Contagens do backup remoto não conferem")
    return counts


def prepare(args):
    snapshot, manifest = migration.read_backup(args.snapshot)
    raw = Path(args.snapshot).read_bytes()
    mapping = read_mapping(args.mapping)
    execute(args.project, args.branch, args.production_authorized,
            preparation_queries(snapshot, manifest, raw, mapping))
    try:
        counts = verify_archive(args.project, args.branch, args.production_authorized, manifest["sha256"])
        migration.api("neon", f"/projects/{args.project}/branches/{args.branch}/data-api/{DATABASE}", {}, "PATCH")
    except (ValueError, RuntimeError, OSError, KeyError):
        raise RuntimeError("Cópia confirmada no destino; a verificação posterior não terminou. Use status/verify-archive e atualize o cache da API; não repita prepare.") from None
    print(json.dumps({"production_target_prepared": True, "remote_private_backup_verified": True,
                      "counts": counts, "new_logins_bound": False, "target_writes_enabled": False,
                      "source_frozen": False, "frontend_switched": False}))


def status(args):
    query = """SELECT c.phase,c.prepared_at,c.snapshot_sha256,
      (SELECT count(*) FROM application_private.accounts) AS legacy_accounts,
      (SELECT count(*) FROM application_private.accounts WHERE auth_subject IS NOT NULL) AS linked_accounts,
      (SELECT count(*) FROM application_private.login_reservations r JOIN neon_auth."user" u
        ON lower(u.email)=r.email WHERE u."emailVerified" AND NOT coalesce(u.banned,false)) AS verified_reserved_accounts,
      (SELECT bool_or(has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE'))
        FROM unnest(ARRAY['medications','medication_routines','routine_medications','medication_intakes']) t) AS target_write_grants
      FROM application_private.cutover_control c"""
    r = execute(args.project, args.branch, args.production_authorized, [{"query": query, "params": []}])
    print(json.dumps({"status": r["results"][0]["rows"]}))


def prepared_guard(sha=None, unlinked=True):
    return {"query": """SELECT 1 / (EXISTS (SELECT FROM application_private.cutover_control
      WHERE phase='prepared' AND ($1::text IS NULL OR snapshot_sha256=$1))
      AND NOT EXISTS (SELECT FROM unnest(ARRAY['medications','medication_routines','routine_medications','medication_intakes']) t
        WHERE has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE'))
      AND NOT has_function_privilege('authenticated','public.register_application_account()','EXECUTE')
      AND (NOT $2::boolean OR NOT EXISTS (SELECT FROM application_private.accounts WHERE auth_subject IS NOT NULL))
      )::integer AS prepared_and_closed""", "params": [sha, unlinked]}


def source_status():
    if os.environ.get("SUPABASE_PROJECT_ID", SOURCE) != SOURCE:
        raise ValueError("Projeto de origem configurado diverge do autorizado")
    def read(query):
        return migration.api("supabase", f"/projects/{SOURCE}/database/query", {"query": query, "read_only": True})
    if not read("SELECT to_regnamespace('medication_cutover_private') IS NOT NULL AS present")[0]["present"]:
        return {"frozen": False}
    result = read("""SELECT frozen_at,
      (SELECT count(*)=4 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname IN ('medications','medication_routines','routine_medications','medication_intakes')
         AND t.tgname='medication_neon_cutover' AND t.tgenabled='A' AND t.tgtype=62
         AND t.tgfoid='medication_cutover_private.reject_write()'::regprocedure) AS frozen
      FROM medication_cutover_private.control WHERE singleton""")
    if len(result) != 1 or not result[0]["frozen"]:
        raise ValueError("Barreira de origem incompleta; interromper e revisar")
    return result[0]


def source_change(args, thaw=False):
    mapping = read_mapping(args.mapping)
    # Validar destino e ambas as identidades antes de abrir a janela.
    checks = [prepared_guard(unlinked=not thaw)]
    if not thaw:
        checks += migration.account_transition_queries(mapping, bind=True)[:2]
    execute(args.project, args.branch, args.production_authorized, checks)
    current = source_status()
    if current["frozen"] == (not thaw):
        raise ValueError("A origem já está no estado solicitado; não reaplicar")
    name = "unfreeze-supabase.sql" if thaw else "freeze-supabase.sql"
    sql = (migration.CHECKOUT / "neon/cutover" / name).read_text()
    migration.api("supabase", f"/projects/{SOURCE}/database/query", {"query": sql, "read_only": False})
    print(json.dumps({"source": source_status(), "target_writes_enabled": False}))


def exact_data_queries(snapshot):
    return [{"query": f"SELECT 1 / ((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY {'routine_id,medication_id' if table == 'routine_medications' else 'id'}),'[]') FROM public.{table} t) = $1::jsonb)::integer AS exact_copy",
             "params": [json.dumps(snapshot[table])]} for table in migration.TABLES]


def finalization_queries(previous, previous_manifest, snapshot, manifest, raw, mapping, frozen_at):
    for data, meta in ((previous, previous_manifest), (snapshot, manifest)):
        if meta["source_project"] != SOURCE or migration.validate_snapshot(data) != meta["counts"]:
            raise ValueError("Snapshot/manifesto de origem divergente")
    if hashlib.sha256(raw).hexdigest() != manifest["sha256"] or json.loads(raw) != snapshot:
        raise ValueError("Checksum/conteúdo final divergente")
    if datetime.fromisoformat(snapshot["exported_at"]) < datetime.fromisoformat(frozen_at):
        raise ValueError("Snapshot final é anterior à barreira da origem")
    old_accounts, new_accounts = migration.snapshot_accounts(previous), migration.snapshot_accounts(snapshot)
    if [{k: v for k, v in a.items() if k != "updated_at"} for a in old_accounts] != [{k: v for k, v in a.items() if k != "updated_at"} for a in new_accounts]:
        raise ValueError("Contas/papéis/vínculos de origem mudaram; conciliação administrativa necessária")
    rows = migration.validate_account_mapping(mapping)
    if {r["legacy_id"]: r["role"] for r in rows} != {a["id"]: a["access_role"] for a in new_accounts}:
        raise ValueError("Mapeamento final não corresponde a todas as contas de origem")
    queries = [{"query": "SET LOCAL TIME ZONE 'UTC'", "params": []}, prepared_guard(previous_manifest["sha256"])]
    queries += [{"query": "SELECT 1 / ((SELECT coalesce(jsonb_agg(to_jsonb(a)-'auth_subject' ORDER BY id),'[]') FROM application_private.accounts a)=$1::jsonb)::integer AS exact_accounts", "params": [json.dumps(old_accounts)]}]
    queries += exact_data_queries(previous)
    # Só a cópia preparada, ainda fechada e sem vínculos, pode ser reconciliada.
    # Nenhum registro criado por cliente no destino pode ser sobrescrito.
    for table in reversed(migration.TABLES):
        queries.append({"query": f"DELETE FROM public.{table}", "params": []})
    for table, fields in migration.TABLES.items():
        columns = ",".join(fields)
        queries.append({"query": f"INSERT INTO public.{table} ({columns}) SELECT {columns} FROM jsonb_populate_recordset(NULL::public.{table},$1::jsonb)", "params": [json.dumps(snapshot[table])]})
    queries += exact_data_queries(snapshot)
    queries.append({"query": "UPDATE application_private.accounts a SET updated_at=m.updated_at FROM jsonb_populate_recordset(NULL::application_private.accounts,$1::jsonb) m WHERE a.id=m.id", "params": [json.dumps(new_accounts)]})
    ddl = migration.CHECKOUT / "neon/migrations/202610220002_cutover_finalization.sql"
    queries += [{"query": s, "params": []} for s in migration.split_sql(ddl.read_text())]
    queries += [
        {"query": "INSERT INTO application_private.source_backups(snapshot_sha256,source_project,exported_at,counts,snapshot_bytes) VALUES($1,$2,$3,$4::jsonb,decode($5,'base64'))", "params": [manifest["sha256"], SOURCE, manifest["exported_at"], json.dumps(manifest["counts"]), base64.b64encode(raw).decode()]},
        {"query": "INSERT INTO application_private.migration_runs(snapshot_sha256,source_project,exported_at) VALUES($1,$2,$3)", "params": [manifest["sha256"], SOURCE, manifest["exported_at"]]},
        {"query": "INSERT INTO application_private.cutover_finalization(singleton,source_frozen_at,snapshot_sha256) VALUES(true,$1,$2)", "params": [frozen_at, manifest["sha256"]]},
        {"query": "UPDATE application_private.cutover_control SET snapshot_sha256=$1 WHERE singleton", "params": [manifest["sha256"]]},
    ]
    queries += migration.account_transition_queries(mapping, bind=True)
    return queries


def finalize(args):
    # Comprovar primeiro a autorização/destino, depois consultar a barreira.
    connection(args.project, args.branch, args.production_authorized)
    frozen = source_status()
    if not frozen["frozen"]:
        raise ValueError("A origem deve estar bloqueada antes da sincronização final")
    previous, old_manifest = migration.read_backup(args.previous_snapshot)
    snapshot, manifest = migration.read_backup(args.snapshot)
    queries = finalization_queries(previous, old_manifest, snapshot, manifest, Path(args.snapshot).read_bytes(), read_mapping(args.mapping), frozen["frozen_at"])
    execute(args.project, args.branch, args.production_authorized, queries)
    counts = verify_archive(args.project, args.branch, args.production_authorized, manifest["sha256"])
    print(json.dumps({"final_copy_exact": True, "remote_backup_verified": True, "accounts_linked": True, "counts": counts, "target_writes_enabled": False}))


def activation_queries(sha, frozen_at, commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Informe o commit completo do deploy de produção verificado")
    queries = [{"query": "SET LOCAL TIME ZONE 'UTC'", "params": []}, prepared_guard(sha, unlinked=False), {"query": """SELECT 1 / (
      EXISTS (SELECT FROM application_private.cutover_finalization WHERE snapshot_sha256=$1 AND source_frozen_at=$2::timestamptz)
      AND NOT EXISTS (SELECT FROM application_private.accounts a
        LEFT JOIN neon_auth."user" u ON u.id::text=a.auth_subject
        LEFT JOIN application_private.login_reservations r ON r.account_id=a.id AND r.email=lower(u.email)
        WHERE u.id IS NULL OR NOT u."emailVerified" OR coalesce(u.banned,false) OR r.account_id IS NULL)
      )::integer AS finalized_and_verified""", "params": [sha, frozen_at]}]
    # A última cópia ainda precisa ser idêntica ao backup remoto final.
    for table in migration.TABLES:
        order = "routine_id,medication_id" if table == "routine_medications" else "id"
        queries.append({"query": f"SELECT 1 / ((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY {order}),'[]') FROM public.{table} t)=(SELECT convert_from(snapshot_bytes,'UTF8')::jsonb->$2 FROM application_private.source_backups WHERE snapshot_sha256=$1))::integer AS still_exact", "params": [sha, table]})
        queries.append({"query": f"GRANT INSERT,UPDATE,DELETE ON public.{table} TO authenticated", "params": []})
    queries += [
        {"query": "GRANT EXECUTE ON FUNCTION public.register_application_account() TO authenticated", "params": []},
        {"query": "UPDATE application_private.cutover_finalization SET deployment_commit=$1 WHERE singleton", "params": [commit]},
        {"query": "UPDATE application_private.cutover_control SET phase='active',activated_at=now() WHERE singleton", "params": []},
    ]
    return queries


def activate(args):
    connection(args.project, args.branch, args.production_authorized)
    frozen = source_status()
    if not frozen["frozen"]:
        raise ValueError("Ativação recusada: a origem está aberta para alterações")
    verify_frontend(args.deployment_commit)
    execute(args.project, args.branch, args.production_authorized, activation_queries(args.sha256, frozen["frozen_at"], args.deployment_commit))
    print(json.dumps({"neon_active": True, "source_preserved_and_frozen": True}))


def verify_frontend(commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Commit de produção inválido")
    token = os.environ.get("GH_TOKEN")
    if not token:
        raise ValueError("Identidade GitHub necessária para conferir a publicação")
    headers = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json"}
    base = "https://api.github.com/repos/JrJoca/minha-medicacao"
    head = migration.request_json(base + "/git/ref/heads/master", headers=headers)
    if head["object"]["sha"] != commit:
        raise ValueError("Commit solicitado não é a master atual")
    deployments = migration.request_json(base + "/deployments?sha=" + commit, headers=headers)
    ready = False
    for deployment in deployments:
        if deployment["environment"] == "Production":
            states = migration.request_json(base + f'/deployments/{deployment["id"]}/statuses', headers=headers)
            ready = bool(states and states[0]["state"] == "success")
            if ready:
                break
    if not ready:
        raise ValueError("Deploy de produção ainda não foi concluído no commit solicitado")
    origin = "https://minha-medicacao.vercel.app"
    def fetch(url):
        with urllib.request.urlopen(url, timeout=60) as response:
            if urllib.parse.urlsplit(response.url).netloc != "minha-medicacao.vercel.app":
                raise ValueError("A aplicação pública redirecionou para outra origem")
            return response.read(10_000_001).decode()
    html = fetch(origin)
    paths = set(re.findall(r'(?:src|href)=["\']([^"\']+\.js)["\']', html))
    if not paths or len(paths) > 32:
        raise ValueError("Não foi possível identificar os scripts da aplicação publicada")
    scripts = []
    for path in paths:
        url = urllib.parse.urljoin(origin, path)
        if urllib.parse.urlsplit(url).netloc != "minha-medicacao.vercel.app":
            raise ValueError("Script publicado fora da origem esperada")
        scripts.append(fetch(url))
    content = "\n".join(scripts)
    config = json.loads((migration.CHECKOUT / "deploy/neon-production.json").read_text())
    if not all(config[k] in content for k in ("auth_url", "data_api_url")) or SOURCE + ".supabase.co" in content:
        raise ValueError("O frontend público ainda não aponta exclusivamente para o Neon final")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "status", "verify-archive", "freeze-source", "unfreeze-source", "source-status", "finalize", "activate"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--project", default=PROJECT)
        cmd.add_argument("--branch", default=BRANCH)
        cmd.add_argument("--production-authorized", action="store_true")
        if name in ("prepare", "finalize"):
            cmd.add_argument("--snapshot", required=True)
        if name in ("prepare", "finalize", "freeze-source", "unfreeze-source"):
            cmd.add_argument("--mapping", required=True)
        if name == "finalize":
            cmd.add_argument("--previous-snapshot", required=True)
        if name in ("verify-archive", "activate"):
            cmd.add_argument("--sha256", required=True)
        if name == "activate":
            cmd.add_argument("--deployment-commit", required=True, help="SHA do frontend de produção já conferido")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args)
    elif args.command == "status":
        status(args)
    elif args.command in ("freeze-source", "unfreeze-source"):
        source_change(args, thaw=args.command == "unfreeze-source")
    elif args.command == "source-status":
        connection(args.project, args.branch, args.production_authorized)
        print(json.dumps({"source": source_status()}))
    elif args.command == "finalize":
        finalize(args)
    elif args.command == "activate":
        activate(args)
    else:
        print(json.dumps({"remote_private_backup_verified": True, "counts": verify_archive(args.project, args.branch, args.production_authorized, args.sha256)}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(str(error) if isinstance(error, (ValueError, RuntimeError)) else "Operação interrompida; nenhum detalhe privado publicado", file=sys.stderr)
        sys.exit(1)
