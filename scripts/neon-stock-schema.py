#!/usr/bin/env python3
"""Ampliação aditiva autorizada do estoque, com ensaio e backup privado."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import uuid

spec = importlib.util.spec_from_file_location("cutover", Path(__file__).with_name("neon-cutover.py"))
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)
migration = cutover.migration
VERSION = "202610220003_medication_stock"
SQL = migration.CHECKOUT / "neon/migrations" / (VERSION + ".sql")


def legacy_state_sql():
    parts = []
    for table in migration.TABLES:
        order = "routine_id,medication_id" if table == "routine_medications" else "id"
        parts.append(f"'{table}',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY {order}) FROM public.{table} t),'[]')")
    parts.append("'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM application_private.accounts a),'[]')")
    return "jsonb_build_object(" + ",".join(parts) + ")"


def upgrade_queries(backup_branch, backup_sha):
    checksum = hashlib.sha256(SQL.read_bytes()).hexdigest()
    queries = [
        {"query": "SET LOCAL lock_timeout='5s'", "params": []},
        {"query": "SET LOCAL statement_timeout='30s'", "params": []},
        {"query": "SELECT 1 / pg_try_advisory_xact_lock(20261022,3)::integer AS exclusive_upgrade", "params": []},
        {"query": "SELECT 1 / ((to_regclass('public.medication_stock') IS NULL) AND (to_regclass('application_private.schema_migrations') IS NULL) AND (to_regprocedure('auth.user_id()') IS NOT NULL))::integer AS stock_not_applied", "params": []},
        {"query": f"CREATE TEMP TABLE stock_upgrade_baseline ON COMMIT DROP AS SELECT {legacy_state_sql()} AS content", "params": []},
    ]
    queries += [{"query": statement, "params": []} for statement in migration.split_sql(SQL.read_text())]
    queries += [
        {"query": f"SELECT 1 / ((SELECT content FROM stock_upgrade_baseline)={legacy_state_sql()})::integer AS existing_data_preserved", "params": []},
        {"query": "SELECT 1 / (NOT EXISTS (SELECT FROM public.medication_stock))::integer AS no_invented_stock", "params": []},
        {"query": "INSERT INTO application_private.schema_migrations(version,checksum,backup_branch_id,backup_snapshot_sha256) VALUES($1,$2,$3,$4)", "params": [VERSION, checksum, backup_branch, backup_sha]},
    ]
    return queries


def execute(queries, authorized=False, staging_branch=None):
    if staging_branch:
        # Preserva a recusa de produção do executor de ensaio.
        return migration.execute_staging(cutover.PROJECT, staging_branch, cutover.DATABASE, queries)
    return cutover.execute(cutover.PROJECT, cutover.BRANCH, authorized, queries)


def assert_active(authorized):
    execute([{"query": "SELECT 1 / EXISTS(SELECT FROM application_private.cutover_control WHERE phase='active')::integer AS neon_active", "params": []}], authorized)


def backup(authorized, output):
    assert_active(authorized)
    directory = migration.private_directory(output)
    if any(directory.iterdir()):
        raise ValueError("Use um diretório privado vazio para o novo backup")
    result = execute([{"query": f"SELECT now() AS exported_at,{legacy_state_sql()} AS snapshot", "params": []}], authorized)
    record = result["results"][0]["rows"][0]
    snapshot_path = directory / "neon_snapshot.json"
    migration.write_private(snapshot_path, record)
    checksum = hashlib.sha256(snapshot_path.read_bytes()).hexdigest()
    # A branch sem endpoint conserva também Auth, schemas e demais objetos.
    branch = migration.api("neon", f"/projects/{cutover.PROJECT}/branches", {
        "branch": {"name": "backup-before-stock-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6], "parent_id": cutover.BRANCH}
    })["branch"]
    if branch.get("parent_id") != cutover.BRANCH or branch.get("default"):
        raise ValueError("Metadados da branch de backup divergem do destino esperado")
    schema = migration.api("neon", f"/projects/{cutover.PROJECT}/branches/{cutover.BRANCH}/schema?db_name={cutover.DATABASE}")
    migration.write_private(directory / "schema.json", schema)
    manifest = {"project": cutover.PROJECT, "branch": cutover.BRANCH, "backup_branch_id": branch["id"],
                "exported_at": record["exported_at"], "sha256": checksum,
                "migration_checksum": hashlib.sha256(SQL.read_bytes()).hexdigest(),
                "counts": {name: len(rows) for name, rows in record["snapshot"].items()}}
    migration.write_private(directory / "neon_snapshot.manifest.json", manifest)
    read_backup(snapshot_path)
    print(json.dumps({"private_snapshot_verified": True, "durable_backup_branch_created": True, "backup_branch_id": branch["id"], "counts": manifest["counts"]}))


def read_backup(path):
    path = Path(path).resolve()
    if path.is_relative_to(migration.CHECKOUT) or path.stat().st_mode & 0o077:
        raise ValueError("Backup deve ficar fora do Git com permissão 0600")
    manifest = json.loads(path.with_suffix(".manifest.json").read_text())
    if manifest["project"] != cutover.PROJECT or manifest["branch"] != cutover.BRANCH:
        raise ValueError("Backup de outro destino")
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["sha256"]:
        raise ValueError("Checksum do backup diverge")
    if hashlib.sha256(SQL.read_bytes()).hexdigest() != manifest["migration_checksum"]:
        raise ValueError("SQL mudou depois do backup; repetir a revisão/backup")
    record = json.loads(path.read_bytes())
    if record["exported_at"] != manifest["exported_at"] or {n: len(rows) for n, rows in record["snapshot"].items()} != manifest["counts"]:
        raise ValueError("Conteúdo do backup não confere com o manifesto")
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(record["exported_at"])).total_seconds()
    if not 0 <= age <= 3600:
        raise ValueError("Backup deve ser recente, obtido na última hora")
    branch = migration.api("neon", f'/projects/{cutover.PROJECT}/branches/{manifest["backup_branch_id"]}')["branch"]
    if branch.get("parent_id") != cutover.BRANCH or branch.get("default"):
        raise ValueError("Branch de recuperação inválida")
    return manifest


def refresh_cache(branch):
    migration.api("neon", f"/projects/{cutover.PROJECT}/branches/{branch}/data-api/{cutover.DATABASE}", {}, "PATCH")


def apply(authorized, snapshot_path):
    assert_active(authorized)
    manifest = read_backup(snapshot_path)
    execute(upgrade_queries(manifest["backup_branch_id"], manifest["sha256"]), authorized)
    try:
        refresh_cache(cutover.BRANCH)
    except (RuntimeError, ValueError, OSError):
        raise RuntimeError("Ampliação confirmada; atualização do cache da API falhou. Use status e refresh-cache; não repita apply.") from None
    print(json.dumps({"stock_schema_applied": True, "existing_records_preserved": True,
                      "legacy_stock_populated": False, "medication_form_changed": False}))


def status(authorized=False, staging_branch=None):
    exists = execute([{"query": "SELECT to_regclass('public.medication_stock') IS NOT NULL AS applied", "params": []}], authorized, staging_branch)
    if not exists["results"][0]["rows"][0]["applied"]:
        print(json.dumps({"stock_schema_applied": False}))
        return
    query = """SELECT s.version,s.checksum,s.applied_at,
      (SELECT relrowsecurity FROM pg_class WHERE oid='public.medication_stock'::regclass) AS rls_enabled,
      (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='medication_stock') AS policies,
      (SELECT count(*) FROM public.medication_stock) AS configured_medications,
      NOT has_table_privilege('anonymous','public.medication_stock','SELECT') AS anonymous_blocked
      FROM application_private.schema_migrations s WHERE version=$1"""
    result = execute([{"query": query, "params": [VERSION]}], authorized, staging_branch)
    print(json.dumps({"stock_schema": result["results"][0]["rows"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "apply", "status", "refresh-cache", "rehearse"):
        command = sub.add_parser(name)
        command.add_argument("--production-authorized", action="store_true")
        if name == "backup":
            command.add_argument("--output", required=True)
        if name == "apply":
            command.add_argument("--backup", required=True)
        if name in ("rehearse", "status"):
            command.add_argument("--staging-branch", required=name == "rehearse")
    args = parser.parse_args()
    if args.command == "backup":
        backup(args.production_authorized, args.output)
    elif args.command == "apply":
        apply(args.production_authorized, args.backup)
    elif args.command == "status":
        status(args.production_authorized, args.staging_branch)
    elif args.command == "refresh-cache":
        assert_active(args.production_authorized)
        refresh_cache(cutover.BRANCH)
        print(json.dumps({"schema_cache_refreshed": True}))
    else:
        execute(upgrade_queries("synthetic-fixtures", "0" * 64), staging_branch=args.staging_branch)
        refresh_cache(args.staging_branch)
        status(staging_branch=args.staging_branch)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(str(error) if isinstance(error, (ValueError, RuntimeError)) else "Operação interrompida; nenhum detalhe privado publicado", file=sys.stderr)
        sys.exit(1)
