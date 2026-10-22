import importlib.util
import os
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("cutover", Path(__file__).parents[1] / "scripts/neon-cutover.py")
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


class CutoverTests(unittest.TestCase):
    def test_production_requires_explicit_execution_flag_before_any_network(self):
        with mock.patch.object(cutover.migration, "api") as api:
            with self.assertRaisesRegex(ValueError, "production-authorized"):
                cutover.connection(cutover.PROJECT, cutover.BRANCH, False)
            api.assert_not_called()

    def test_other_production_and_staging_branches_are_rejected(self):
        with mock.patch.object(cutover.migration, "api") as api:
            for project, branch in [(cutover.PROJECT, "br-empty-water-b5nntdyc"), ("other-project", cutover.BRANCH)]:
                with self.subTest(project=project, branch=branch), self.assertRaisesRegex(ValueError, "Destino diferente"):
                    cutover.connection(project, branch, True)
            api.assert_not_called()

    def test_runtime_destination_mismatch_is_rejected(self):
        with mock.patch.dict(os.environ, {"NEON_PROJECT_ID": "other-project"}), mock.patch.object(cutover.migration, "api") as api:
            with self.assertRaisesRegex(ValueError, "divergem"):
                cutover.connection(cutover.PROJECT, cutover.BRANCH, True)
            api.assert_not_called()

    def test_renamed_or_changed_default_is_rejected_before_connection(self):
        with mock.patch.dict(os.environ, {"NEON_PROJECT_ID": cutover.PROJECT, "NEON_BRANCH_ID": cutover.BRANCH}):
            with mock.patch.object(cutover.migration, "api", return_value={"branch": {"id": cutover.BRANCH, "default": False, "name": "production"}}) as api:
                with self.assertRaisesRegex(ValueError, "mudou"):
                    cutover.connection(cutover.PROJECT, cutover.BRANCH, True)
                api.assert_called_once()

    def test_connection_to_another_database_is_rejected(self):
        responses = [{"branch": {"id": cutover.BRANCH, "default": True, "name": "production"}},
                     {"uri": "postgresql://ep-fixture.invalid/another_database"}]
        with mock.patch.dict(os.environ, {"NEON_PROJECT_ID": cutover.PROJECT, "NEON_BRANCH_ID": cutover.BRANCH}):
            with mock.patch.object(cutover.migration, "api", side_effect=responses) as api:
                with self.assertRaisesRegex(ValueError, "Banco retornado"):
                    cutover.connection(cutover.PROJECT, cutover.BRANCH, True)
                self.assertEqual(api.call_count, 2)


if __name__ == "__main__":
    unittest.main()
