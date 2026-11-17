"""Endpoint configuration regression checks; no Databricks access required."""

import os
import unittest
from unittest.mock import patch

from agent_server.model_config import get_model_endpoint


class ModelConfigTest(unittest.TestCase):
    def test_defaults_to_users_gpt_oss_120b(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_model_endpoint(), "databricks-gpt-oss-120b")

    def test_app_resource_binding_takes_precedence(self):
        with patch.dict(os.environ, {"DATABRICKS_MODEL_ENDPOINT": " custom-serving-endpoint ", "IFC_MODEL_ENDPOINT": "other"}, clear=True):
            self.assertEqual(get_model_endpoint(), "custom-serving-endpoint")

    def test_legacy_local_override_and_blank_values(self):
        with patch.dict(os.environ, {"DATABRICKS_MODEL_ENDPOINT": " ", "IFC_MODEL_ENDPOINT": "legacy-endpoint"}, clear=True):
            self.assertEqual(get_model_endpoint(), "legacy-endpoint")
        with patch.dict(os.environ, {"DATABRICKS_MODEL_ENDPOINT": " ", "IFC_MODEL_ENDPOINT": ""}, clear=True):
            self.assertEqual(get_model_endpoint(), "databricks-gpt-oss-120b")


if __name__ == "__main__":
    unittest.main()
