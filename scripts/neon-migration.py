#!/usr/bin/env python3
"""Backup privado e restauração transacional SOMENTE em branch Neon de ensaio."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

CHECKOUT = Path(__file__).resolve().parents[1]
TABLES = {
    "medications": "id,user_id,name,dosage,reference_url,created_at".split(","),
    "medication_routines": "id,user_id,name,period_description,has_no_end_date,duration_value,duration_unit,current_day,total_days,scheduled_time,deadline_time,reminders_enabled,status,created_at,updated_at".split(","),
    "routine_medications": "user_id,routine_id,medication_id,created_at".split(","),
    "medication_intakes": "id,user_id,routine_id,taken_at,created_at".split(","),
}
API = {
    "supabase": ("https://api.supabase.com/v1", "SUPABASE_ACCESS_TOKEN"),
    "neon": ("https://console.neon.tech/api/v2", "NEON_API_KEY"),
}


def request_json(url, body=None, headers=None, method=None):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Erros SQL podem conter valores pessoais: não imprimir o corpo.
        raise RuntimeError(f"Requisição recusada: HTTP {error.code}") from None


def api(service, path, body=None, method=None):
    base, variable = API[service]
    token = os.environ.get(variable)
    if not token:
        raise ValueError(f"Configure o segredo {variable} no ambiente")
    return request_json(base + path, body, {"Authorization": "Bearer " + token}, method)


def private_directory(path):
    path = Path(path).resolve()
    if path.is_relative_to(CHECKOUT):
        raise ValueError("Backups devem ficar fora do checkout Git")
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.stat().st_mode & 0o077:
        raise ValueError("Use um diretório privado com permissão 0700")
    return path


def write_private(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)


def validate_snapshot(snapshot):
    if not isinstance(snapshot.get("users"), list) or not snapshot["users"]:
        raise ValueError("Snapshot sem contas de origem")
    users = {}
    emails = set()
    for user in snapshot["users"]:
        identity = str(uuid.UUID(user["id"]))
        email = user.get("email", "").strip().casefold()
        if identity in users or not email or email in emails:
            raise ValueError("Identidade ou e-mail ausente/duplicado; conciliação necessária")
        users[identity] = user
        emails.add(email)
    for user in users.values():
        metadata = user.get("raw_app_meta_data") or {}
        role = metadata.get("role", "owner")
        if role not in ("owner", "viewer"):
            raise ValueError("Papel de origem exige revisão")
        owner = metadata.get("owner_user_id")
        if role == "viewer" and (owner not in users or owner == user["id"]):
            raise ValueError("Visualizador sem proprietário válido")
        if role == "viewer" and (users[owner].get("raw_app_meta_data") or {}).get("role") == "viewer":
            raise ValueError("Proprietário de visualizador não pode ser visualizador")
    indexed = {}
    for table, columns in TABLES.items():
        rows = snapshot.get(table)
        if not isinstance(rows, list):
            raise ValueError("Snapshot incompleto")
        keys = set()
        indexed[table] = {}
        for row in rows:
            if set(row) != set(columns) or row["user_id"] not in users:
                raise ValueError("Esquema ou proprietário divergente da baseline revisada")
            key = (row["routine_id"], row["medication_id"]) if table == "routine_medications" else str(uuid.UUID(row["id"]))
            if key in keys:
                raise ValueError("Snapshot com chave duplicada")
            keys.add(key)
            indexed[table][key] = row
    for table in ("routine_medications", "medication_intakes"):
        for row in snapshot[table]:
            routine = indexed["medication_routines"].get(row["routine_id"])
            if not routine or routine["user_id"] != row["user_id"]:
                raise ValueError("Vínculo de rotina inválido")
            if table == "routine_medications":
                medicine = indexed["medications"].get(row["medication_id"])
                if not medicine or medicine["user_id"] != row["user_id"]:
                    raise ValueError("Vínculo de medicamento inválido")
    return {table: len(snapshot[table]) for table in (*TABLES, "users")}


def read_backup(path):
    path = Path(path).resolve()
    if path.is_relative_to(CHECKOUT) or path.stat().st_mode & 0o077:
        raise ValueError("Snapshot deve ser privado, fora do Git (permissão 0600)")
    manifest = json.loads(path.with_suffix(".manifest.json").read_text())
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != manifest["sha256"]:
        raise ValueError("Checksum do snapshot não confere")
    snapshot = json.loads(content)
    if validate_snapshot(snapshot) != manifest["counts"]:
        raise ValueError("Contagens do manifesto não conferem")
    return snapshot, manifest


def backup(project, output):
    if not re.fullmatch(r"[a-z]{20}", project):
        raise ValueError("Identificador Supabase inválido")
    directory = private_directory(output)
    parts = ["'exported_at',now()"]
    for table in TABLES:
        order = "routine_id,medication_id" if table == "routine_medications" else "id"
        parts.append(f"'{table}',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY {order}) FROM public.{table} t),'[]')")
    parts.append("""'users',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'email',email,'encrypted_password',encrypted_password,
      'email_confirmed_at',email_confirmed_at,'created_at',created_at,'updated_at',updated_at,
      'raw_app_meta_data',raw_app_meta_data,'raw_user_meta_data',raw_user_meta_data,
      'banned_until',banned_until,'deleted_at',deleted_at) ORDER BY id) FROM auth.users),'[]')""")
    result = api("supabase", f"/projects/{project}/database/query", {
        "query": "SELECT jsonb_build_object(" + ",".join(parts) + ") AS snapshot",
        "read_only": True,
    })
    snapshot = result[0]["snapshot"]
    counts = validate_snapshot(snapshot)
    path = directory / "source_snapshot.json"
    write_private(path, snapshot)
    manifest = {"source_project": project, "exported_at": snapshot["exported_at"],
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "counts": counts,
                "scope": "medication domain and accounts; public.links excluded"}
    write_private(path.with_suffix(".manifest.json"), manifest)
    print(json.dumps({"backup_saved": True, "counts": counts}))


def split_sql(source):
    """Separar statements mantendo strings, identificadores e blocos dollar-quoted."""
    statements = []
    start = index = 0
    quote = None
    while index < len(source):
        if quote:
            if source.startswith(quote, index):
                index += len(quote)
                if quote in ("'", '"') and source.startswith(quote, index):
                    index += len(quote)
                else:
                    quote = None
            else:
                index += 1
            continue
        if source.startswith("--", index):
            end = source.find("\n", index)
            index = len(source) if end == -1 else end + 1
            continue
        if source.startswith("/*", index):
            raise ValueError("Use comentários SQL de linha; blocos não são suportados pelo executor")
        if source[index] in ("'", '"'):
            quote = source[index]
            index += 1
            continue
        match = re.match(r"\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$", source[index:])
        if match:
            quote = match.group()
            index += len(quote)
            continue
        if source[index] == ";":
            if source[start:index].strip():
                statements.append(source[start:index].strip())
            start = index + 1
        index += 1
    if quote:
        raise ValueError("SQL com literal não terminado")
    if source[start:].strip():
        statements.append(source[start:].strip())
    return statements


def snapshot_accounts(snapshot):
    accounts = []
    for user in snapshot["users"]:
        metadata = user.get("raw_app_meta_data") or {}
        banned = user.get("banned_until")
        active = not user.get("deleted_at") and (not banned or datetime.fromisoformat(banned.replace("Z", "+00:00")) <= datetime.now(timezone.utc))
        accounts.append({"id": user["id"], "source_email": user["email"],
                         "access_role": metadata.get("role", "owner"),
                         "owner_user_id": metadata.get("owner_user_id") if metadata.get("role") == "viewer" else None,
                         "is_active": bool(active), "created_at": user["created_at"], "updated_at": user["updated_at"] or user["created_at"]})
    return sorted(accounts, key=lambda account: account["id"])


def restoration_queries(snapshot, manifest):
    accounts = snapshot_accounts(snapshot)
    queries = [{"query": "SET LOCAL TIME ZONE 'UTC'", "params": []}]
    for filename in ("202610210001_medication_core.sql", "202610210002_account_registration.sql"):
        migration = CHECKOUT / "neon/migrations" / filename
        queries += [{"query": statement, "params": []} for statement in split_sql(migration.read_text())]
    columns = "id,source_email,access_role,owner_user_id,is_active,created_at,updated_at"
    queries.append({"query": f"INSERT INTO application_private.accounts ({columns}) SELECT {columns} FROM jsonb_populate_recordset(NULL::application_private.accounts,$1::jsonb)", "params": [json.dumps(accounts)]})
    queries.append({"query": "SELECT 1 / ((SELECT coalesce(jsonb_agg(to_jsonb(a) - 'auth_subject' ORDER BY id),'[]') FROM application_private.accounts a) = $1::jsonb)::integer AS exact_accounts", "params": [json.dumps(sorted(accounts, key=lambda account: account["id"]))]})
    for table, fields in TABLES.items():
        columns = ",".join(fields)
        queries.append({"query": f"INSERT INTO public.{table} ({columns}) SELECT {columns} FROM jsonb_populate_recordset(NULL::public.{table},$1::jsonb)", "params": [json.dumps(snapshot[table])]})
        # Uma diferença de conteúdo aborta a transação inteira, não apenas o relatório.
        order = "routine_id,medication_id" if table == "routine_medications" else "id"
        queries.append({"query": f"SELECT 1 / ((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY {order}),'[]') FROM public.{table} t) = $1::jsonb)::integer AS exact_copy", "params": [json.dumps(snapshot[table])]})
    queries.append({"query": "INSERT INTO application_private.migration_runs(snapshot_sha256,source_project,exported_at) VALUES($1,$2,$3)", "params": [manifest["sha256"], manifest["source_project"], manifest["exported_at"]]})
    return queries


def staging_connection(project, branch, database):
    if not re.fullmatch(r"[a-z0-9-]+", project) or not re.fullmatch(r"br-[a-z0-9-]+", branch):
        raise ValueError("Projeto/branch inválido")
    base = f"/projects/{project}"
    metadata = api("neon", base + "/branches/" + branch)["branch"]
    if metadata.get("default") or metadata.get("protected") or metadata.get("name", "").lower() in ("production", "prod", "master", "main"):
        raise ValueError("Este executor recusa branches de produção/default/protegidas")
    parameters = urllib.parse.urlencode({"branch_id": branch, "database_name": database, "role_name": "neondb_owner", "pooled": "false"})
    connection = api("neon", base + "/connection_uri?" + parameters)["uri"]
    host = urllib.parse.urlsplit(connection).hostname
    endpoints = api("neon", base + "/endpoints")["endpoints"]
    if not any(e["branch_id"] == branch and e["host"] == host for e in endpoints):
        raise ValueError("Conexão não corresponde à branch confirmada")
    return host, connection


def execute_staging(project, branch, database, queries):
    host, connection = staging_connection(project, branch, database)
    if callable(queries):
        queries = queries()
    return request_json("https://" + host + "/sql", {"queries": queries}, {
        "Neon-Connection-String": connection,
        "Neon-Batch-Isolation-Level": "Serializable",
    })


def restore(project, branch, database, path):
    snapshot, manifest = read_backup(path)
    preflight = {"query": "SELECT 1 / ((to_regprocedure('auth.user_id()') IS NOT NULL) AND (to_regclass('neon_auth.\"user\"') IS NOT NULL))::integer AS official_services_ready", "params": []}
    execute_staging(project, branch, database, lambda: [preflight, *restoration_queries(snapshot, manifest)])
    try:
        api("neon", f"/projects/{project}/branches/{branch}/data-api/{urllib.parse.quote(database, safe='')}", {}, "PATCH")
    except RuntimeError:
        raise RuntimeError("Cópia confirmada, mas a atualização do cache da API falhou. Atualize o cache; não reaplique a importação.") from None
    print(json.dumps({"restored_and_exactly_compared": True, "counts": manifest["counts"],
                      "auth_status": "accounts preserved; new auth identities not yet linked"}))


def validate_account_mapping(mapping):
    rows = mapping.get("accounts")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Mapeamento de contas vazio")
    identities, emails = set(), set()
    for row in rows:
        if set(row) != {"legacy_id", "role", "login_email"}:
            raise ValueError("Campos inesperados no mapeamento")
        identity = str(uuid.UUID(row["legacy_id"]))
        email = row["login_email"]
        if identity in identities or email in emails or row["role"] not in ("owner", "viewer"):
            raise ValueError("Conta, papel ou e-mail duplicado/inválido")
        if email != email.strip().lower() or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or email.endswith(".local"):
            raise ValueError("Informe um e-mail válido normalizado, sem domínio .local")
        identities.add(identity)
        emails.add(email)
    return rows


def account_transition_queries(mapping, bind=False):
    rows = validate_account_mapping(mapping)
    payload = json.dumps(rows)
    recordset = "jsonb_to_recordset($1::jsonb) AS m(legacy_id uuid,role text,login_email text)"
    queries = [{"query": f"""SELECT 1 / ((SELECT count(*) FROM {recordset}
      JOIN application_private.accounts a ON a.id=m.legacy_id
      AND a.access_role=m.role AND a.is_active AND a.auth_subject IS NULL) = $2)::integer AS all_accounts_ready""",
      "params": [payload, len(rows)]}]
    if not bind:
        queries.append({"query": f"INSERT INTO application_private.login_reservations(account_id,email) SELECT legacy_id,login_email FROM {recordset}", "params": [payload]})
    else:
        # O endereço foi escolhido pelo administrador; o serviço precisa confirmar
        # a posse do e-mail antes da ligação. Não altera IDs, papéis ou proprietário.
        queries.append({"query": f"""SELECT 1 / ((SELECT count(*) FROM {recordset}
          JOIN application_private.login_reservations r ON r.account_id=m.legacy_id AND r.email=m.login_email
          JOIN neon_auth."user" u ON lower(u.email)=m.login_email
            AND u."emailVerified" AND NOT coalesce(u.banned,false)) = $2)::integer AS all_identities_verified""",
          "params": [payload, len(rows)]})
        queries.append({"query": f"""UPDATE application_private.accounts a SET auth_subject=u.id::text
          FROM {recordset} JOIN neon_auth."user" u ON lower(u.email)=m.login_email
          WHERE a.id=m.legacy_id AND a.auth_subject IS NULL""", "params": [payload]})
    return queries


def transition_accounts(project, branch, database, path, bind):
    path = Path(path).resolve()
    if path.is_relative_to(CHECKOUT) or path.stat().st_mode & 0o077:
        raise ValueError("Mapeamento deve ser privado, fora do Git (0600)")
    mapping = json.loads(path.read_text())
    execute_staging(project, branch, database, account_transition_queries(mapping, bind))
    print(json.dumps({"accounts": len(mapping["accounts"]), "status": "linked" if bind else "reserved",
                      "passwords_or_emails_sent": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("backup")
    command.add_argument("--source-project", required=True)
    command.add_argument("--output", required=True)
    command = sub.add_parser("verify-backup")
    command.add_argument("--snapshot", required=True)
    command = sub.add_parser("restore-staging")
    command.add_argument("--snapshot", required=True)
    command.add_argument("--project", required=True)
    command.add_argument("--branch", required=True)
    command.add_argument("--database", default="neondb")
    for name in ("reserve-logins-staging", "bind-accounts-staging"):
        command = sub.add_parser(name)
        command.add_argument("--mapping", required=True)
        command.add_argument("--project", required=True)
        command.add_argument("--branch", required=True)
        command.add_argument("--database", default="neondb")
    args = parser.parse_args()
    if args.command == "backup":
        backup(args.source_project, args.output)
    elif args.command == "verify-backup":
        _, manifest = read_backup(args.snapshot)
        print(json.dumps({"checksum_and_relationships": "passed", "counts": manifest["counts"]}))
    elif args.command == "restore-staging":
        restore(args.project, args.branch, args.database, args.snapshot)
    else:
        transition_accounts(args.project, args.branch, args.database, args.mapping,
                            args.command == "bind-accounts-staging")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        # Não publicar valores de contas, tokens ou erros SQL detalhados.
        if isinstance(error, (ValueError, RuntimeError)):
            print(str(error), file=sys.stderr)
        else:
            print("Operação interrompida; confira conectividade, arquivo privado e formato esperado", file=sys.stderr)
        sys.exit(1)
