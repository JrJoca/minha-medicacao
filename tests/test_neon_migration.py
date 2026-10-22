import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("migration", Path(__file__).parents[1] / "scripts/neon-migration.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def snapshot(self):
        snapshot = {table: [] for table in migration.TABLES}
        snapshot["users"] = [{"id": "00000000-0000-4000-8000-000000000001", "email": "fixture@example.invalid", "raw_app_meta_data": {}}]
        return snapshot

    def test_missing_table_is_rejected(self):
        snapshot = self.snapshot()
        del snapshot["medications"]
        with self.assertRaisesRegex(ValueError, "incompleto"):
            migration.validate_snapshot(snapshot)

    def test_email_duplicates_are_not_silently_merged(self):
        snapshot = self.snapshot()
        snapshot["users"].append({**snapshot["users"][0], "id": "00000000-0000-4000-8000-000000000002", "email": "FIXTURE@example.invalid"})
        with self.assertRaisesRegex(ValueError, "duplicado"):
            migration.validate_snapshot(snapshot)

    def test_viewer_without_owner_is_rejected(self):
        snapshot = self.snapshot()
        snapshot["users"][0]["raw_app_meta_data"] = {"role": "viewer"}
        with self.assertRaisesRegex(ValueError, "proprietário"):
            migration.validate_snapshot(snapshot)

    def test_unknown_roles_are_not_promoted(self):
        snapshot = self.snapshot()
        snapshot["users"][0]["raw_app_meta_data"] = {"role": "unknown"}
        with self.assertRaisesRegex(ValueError, "Papel"):
            migration.validate_snapshot(snapshot)

    def test_account_mapping_rejects_duplicates_and_non_deliverable_alias(self):
        account = {"legacy_id": self.snapshot()["users"][0]["id"], "role": "viewer", "login_email": "viewer@example.invalid"}
        for rows in ([account, account], [{**account, "login_email": "viewer@application.local"}], [{**account, "role": "admin"}], [{**account, "login_email": "VIEWER@example.invalid"}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                migration.validate_account_mapping({"accounts": rows})

    def test_unknown_columns_require_schema_review(self):
        snapshot = self.snapshot()
        snapshot["medications"] = [{column: None for column in migration.TABLES["medications"]}]
        snapshot["medications"][0]["user_id"] = snapshot["users"][0]["id"]
        snapshot["medications"][0]["unreviewed_column"] = True
        with self.assertRaisesRegex(ValueError, "Esquema"):
            migration.validate_snapshot(snapshot)

    def test_checksum_detects_modified_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.json"
            migration.write_private(path, self.snapshot())
            migration.write_private(path.with_suffix(".manifest.json"), {"sha256": "0" * 64})
            with self.assertRaisesRegex(ValueError, "Checksum"):
                migration.read_backup(path)

    def test_backup_cannot_be_written_to_git_checkout(self):
        with self.assertRaisesRegex(ValueError, "fora do checkout"):
            migration.private_directory(migration.CHECKOUT / "outputs" / "backup")

    def test_private_writer_does_not_overwrite_existing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backup.json"
            migration.write_private(path, {"original": True})
            with self.assertRaises(FileExistsError):
                migration.write_private(path, {"original": False})
            self.assertEqual(json.loads(path.read_text()), {"original": True})
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)

    def test_sql_splitter_preserves_function_bodies_and_literals(self):
        sql = "-- heading;\nSELECT 'it''s;ok'; DO $body$ BEGIN PERFORM ';'; END; $body$; SELECT 1;"
        statements = migration.split_sql(sql)
        self.assertEqual(len(statements), 3)
        self.assertIn("PERFORM ';'", statements[1])

    def test_sql_splitter_rejects_unterminated_literal(self):
        with self.assertRaisesRegex(ValueError, "não terminado"):
            migration.split_sql("SELECT 'unfinished;")

    def test_ambiguous_block_comments_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "blocos"):
            migration.split_sql("/* statement; */ SELECT 1;")

    def test_restore_refuses_production_before_requesting_a_connection(self):
        for metadata in ({"default": True}, {"protected": True}, {"name": "production"}):
            with self.subTest(metadata=metadata):
                with mock.patch.object(migration, "read_backup", return_value=(self.snapshot(), {})), \
                     mock.patch.object(migration, "api", return_value={"branch": metadata}) as api, \
                     mock.patch.object(migration, "request_json") as sql:
                    with self.assertRaisesRegex(ValueError, "recusa branches"):
                        migration.restore("fixture-project", "br-fixture-test", "neondb", "unused")
                    api.assert_called_once()
                    sql.assert_not_called()


if __name__ == "__main__":
    unittest.main()
