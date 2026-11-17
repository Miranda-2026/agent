"""Serve the IFC workspace alongside the existing ResponsesAgent endpoint."""

import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

DEFAULT_DASHBOARD_URL = (
    "https://dbc-3e5b0d11-f3e0.cloud.databricks.com/dashboardsv3/"
    "01f1de13749f12779d1d9ab2c3b51f66/published?o=7474649226576612"
)
DEFAULT_CONTEXT_TABLES = (
    "workspace.ifc_case_comp.external_news",
    "workspace.ifc_case_comp.industry_reports",
    "workspace.ifc_case_comp.regional_risk_reports",
)


class WorkspaceAssets(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


def register_ui(app: FastAPI) -> None:
    """No agent, authentication, or invocation handlers are replaced here."""
    assets = Path(__file__).parent / "static"
    app.mount("/ui-assets", WorkspaceAssets(directory=assets), name="ifc-ui-assets")

    @app.get("/", include_in_schema=False)
    async def workspace():
        return FileResponse(assets / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/ui-config", include_in_schema=False)
    async def ui_config():
        dashboard_url = os.getenv("DASHBOARD_URL", DEFAULT_DASHBOARD_URL).strip()
        # Configuration is public; credentials and agent settings stay server-side.
        try:
            parsed = urlsplit(dashboard_url)
            valid = (
                parsed.scheme == "https"
                and bool(parsed.hostname)
                and not parsed.username
                and not parsed.password
            )
        except ValueError:
            valid = False
        return {
            "dashboard_url": dashboard_url if valid else None,
            "context_tables": list(DEFAULT_CONTEXT_TABLES),
        }
