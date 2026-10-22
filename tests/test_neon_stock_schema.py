import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timezone, timedelta

spec = importlib.util.spec_from_file_location("stock", Path(__file__).parents[1] / "scripts/neon-stock-schema.py")
stock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stock)


class StockSchemaTests(unittest.TestCase):
    stockmodule = stock

    def setUp(self):
        self.stock = self.stockmodule

    def test_production_without_flag_is_rejected_before_network(self):
        with mock.patch.object(self.stock.migration, "api") as api:
            with self.assertRaisesRegex(ValueError, "production-authorized"):
                self.stock.assert_active(False)
            api.assert_not_called()

    def make_backup(self, directory, age=0):
        path = Path(directory) / "neon_snapshot.json"
        time = (datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat()
        self.stock.migration.write_private(path, {"exported_at": time, "snapshot": {"medications": []}})
        manifest = {"project": self.stock.cutover.PROJECT, "branch": self.stock.cutover.BRANCH,
                    "backup_branch_id": "br-fixture", "exported_at": time,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "migration_checksum": hashlib.sha256(self.stock.SQL.read_bytes()).hexdigest(), "counts": {"medications": 0}}
        self.stock.migration.write_private(path.with_suffix(".manifest.json"), manifest)
        return path

    def test_private_backup_is_verified_and_recovery_branch_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_backup(directory)
            with mock.patch.object(self.stock.migration, "api", return_value={"branch": {"parent_id": self.stock.cutover.BRANCH, "default": False}}) as api:
                self.assertEqual(self.stock.read_backup(path)["counts"], {"medications": 0})
                api.assert_called_once()

    def test_checksum_mismatch_and_public_permissions_refuse_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_backup(directory)
            with mock.patch.object(self.stock.migration, "api") as api:
                path.write_text("{}")
                with self.assertRaisesRegex(ValueError, "Checksum"):
                    self.stock.read_backup(path)
                os.chmod(path, 0o644)
                with self.assertRaisesRegex(ValueError, "0600"):
                    self.stock.read_backup(path)
                api.assert_not_called()

    def test_old_backup_is_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_backup(directory, age=7200)
            with mock.patch.object(self.stock.migration, "api") as api:
                with self.assertRaisesRegex(ValueError, "última hora"):
                    self.stock.read_backup(path)
                api.assert_not_called()

    def test_recovery_branch_from_another_parent_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_backup(directory)
            with mock.patch.object(self.stock.migration, "api", return_value={"branch": {"parent_id": "br-another", "default": False}}):
                with self.assertRaisesRegex(ValueError, "recuperação inválida"):
                    self.stock.read_backup(path)


spec_routine = importlib.util.spec_from_file_location("routine_stock", Path(__file__).parents[1] / "scripts/neon-routine-stock.py")
routine_stock = importlib.util.module_from_spec(spec_routine)
spec_routine.loader.exec_module(routine_stock)


class RoutineStockSchemaTests(StockSchemaTests):
    stockmodule = routine_stock


if __name__ == "__main__":
    unittest.main()
