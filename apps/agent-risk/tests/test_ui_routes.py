"""UI integration checks without Databricks credentials or an LLM request."""

import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent_server.ui import DEFAULT_DASHBOARD_URL, DEFAULT_CONTEXT_TABLES, register_ui


class WorkspaceRoutesTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        @app.post("/invocations")
        async def existing_invocations(body: dict):
            return body

        register_ui(app)
        self.client = TestClient(app)

    def test_workspace_and_module_assets_are_served(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Hi, how can I", response.text)
        for path in ["styles.css", "app.mjs", "core.mjs", "context.mjs"]:
            asset = self.client.get("/ui-assets/" + path)
            self.assertEqual(asset.status_code, 200)
            self.assertEqual(asset.headers["cache-control"], "no-cache")
            if path.endswith(".mjs"):
                self.assertIn("javascript", asset.headers["content-type"])

    def test_existing_agent_endpoint_is_preserved(self):
        request = {"input": [{"role": "user", "content": "hello"}], "stream": False}
        self.assertEqual(self.client.post("/invocations", json=request).json(), request)

    def test_dashboard_configuration_exposes_no_credentials(self):
        with patch.dict(os.environ, {"DASHBOARD_URL": DEFAULT_DASHBOARD_URL, "DATABRICKS_TOKEN": "test-only-secret"}):
            self.assertEqual(self.client.get("/ui-config").json(), {"dashboard_url": DEFAULT_DASHBOARD_URL, "context_tables": list(DEFAULT_CONTEXT_TABLES)})

    def test_unsafe_dashboard_and_static_traversal_are_rejected(self):
        with patch.dict(os.environ, {"DASHBOARD_URL": "javascript:alert(1)"}):
            self.assertIsNone(self.client.get("/ui-config").json()["dashboard_url"])
        self.assertEqual(self.client.get("/ui-assets/%2e%2e/ui.py").status_code, 404)


if __name__ == "__main__":
    unittest.main()
