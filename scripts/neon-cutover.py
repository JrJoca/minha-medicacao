#!/usr/bin/env python3
"""Preparação do destino de produção autorizado; não congela nem troca a origem."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import urllib.parse

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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "status", "verify-archive"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--project", default=PROJECT)
        cmd.add_argument("--branch", default=BRANCH)
        cmd.add_argument("--production-authorized", action="store_true")
        if name == "prepare":
            cmd.add_argument("--snapshot", required=True)
            cmd.add_argument("--mapping", required=True)
        if name == "verify-archive":
            cmd.add_argument("--sha256", required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args)
    elif args.command == "status":
        status(args)
    else:
        print(json.dumps({"remote_private_backup_verified": True, "counts": verify_archive(args.project, args.branch, args.production_authorized, args.sha256)}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(str(error) if isinstance(error, (ValueError, RuntimeError)) else "Operação interrompida; nenhum detalhe privado publicado", file=sys.stderr)
        sys.exit(1)
