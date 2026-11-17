"""Start the existing agent API and bundled IFC UI in a single process.

No Node/npm or external chat repository is required. start-server CLI flags
pass through unchanged; --no-ui keeps API-only development available.
"""

import os
import sys


def main():
    if "--no-ui" in sys.argv:
        sys.argv.remove("--no-ui")
        os.environ["IFC_UI_ENABLED"] = "false"

    from agent_server.start_server import main as start_server

    start_server()


if __name__ == "__main__":
    main()
