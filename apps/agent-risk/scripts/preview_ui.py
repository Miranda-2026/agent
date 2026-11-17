"""Preview UI without Databricks credentials: python -m scripts.preview_ui.

This server never invokes an LLM, returns sample recommendations, or proxies
requests to production. Use start-app for a real agent conversation.
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ASSETS = Path(__file__).resolve().parents[1] / "agent_server" / "static"
DASHBOARD = (
    "https://dbc-3e5b0d11-f3e0.cloud.databricks.com/dashboardsv3/"
    "01f1de13749f12779d1d9ab2c3b51f66/published?o=7474649226576612"
)


class PreviewHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/ui-config":
            self.respond(json.dumps({"dashboard_url": DASHBOARD, "context_tables": [
                "workspace.ifc_case_comp.external_news",
                "workspace.ifc_case_comp.industry_reports",
                "workspace.ifc_case_comp.regional_risk_reports",
            ]}).encode(), "application/json")
            return
        routes = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/ui-assets/styles.css": ("styles.css", "text/css; charset=utf-8"),
            "/ui-assets/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
            "/ui-assets/core.mjs": ("core.mjs", "text/javascript; charset=utf-8"),
            "/ui-assets/context.mjs": ("context.mjs", "text/javascript; charset=utf-8"),
        }
        if path not in routes:
            self.send_error(404)
            return
        filename, content_type = routes[path]
        self.respond((ASSETS / filename).read_bytes(), content_type)

    def do_POST(self):
        self.respond(json.dumps({"output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "**UI preview only.** This preview is not connected to your Databricks agent. Run `uv run start-app` in your configured Databricks environment to obtain real analysis and client recommendations. No portfolio values or news have been generated."}]}]}).encode(), "application/json")

    def respond(self, body, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler)
    print(f"UI preview only: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
