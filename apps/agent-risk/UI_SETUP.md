# IFC workspace: direct existing-agent integration

The UI calls the existing Genie Space supplied by the user:
`01f1ddf25d881906b7234f566362469b`.

News/report accordions and the New conversation update are covered in
[CONTEXT_SETUP.md](CONTEXT_SETUP.md), including the three source tables and
the required Genie Data / App resource setup.

The reference analyst prompt has not been copied into this app. The app does
not create another analyst, call a separate foundation model, or rewrite
Genie's answers. The earlier GPT OSS model configuration has been removed.

## Runtime path

Browser -> POST /invocations -> Databricks SDK Genie Conversation API ->
existing Genie Space -> original text/query attachments -> UI rendering.

- `agent_server/agent.py` exposes the existing ResponsesAgent interface.
- `agent_server/genie_client.py` starts and continues native Genie conversations.
- User questions are sent unchanged. No analytical or output-format prompt is
  appended. Genie keeps its own instructions, datasets, tools and calculations.
- Applying weights is an explicit UI action: it sends a visible user message
  listing the selected weights. No hidden scoring rules are added.
- Query SQL and inline result rows are shown beneath the original answer.
  The app limits displayed rows to 200 and identifies partial/unavailable results.
  It does not infer rankings or compute financial figures from those rows.
- Signed query-result download URLs are not sent to the browser.

## Configure the existing agent-risk app

1. Open **agent-risk > Settings > Resources**.
2. Add the supplied **Genie Agent**, with **Can run** permission and resource key
   **`ifc-genie`**. `app.yaml` maps this to `IFC_GENIE_SPACE_ID`.
3. Ensure the app's service identity can use the Genie's SQL warehouse and read
   its configured tables (`USE CATALOG`, `USE SCHEMA`, `SELECT` as applicable).
4. Retain the existing `experiment` resource. For the previously reported trace
   error, grant access to the experiment's actual OTel tables; see ERROR_FIX.md.
5. Deploy the updated source to the same app, and refresh the browser.

For **From Git** deployments, configure resources in App Settings. Merely editing
`databricks.yml` does not apply those resource declarations. For Bundle deployments,
bind/configure the existing agent-risk app and correct workspace/profile first;
the original template bundle app name has not been silently changed.

The Genie Space itself is not modified or recreated. The app uses Databricks SDK
authentication with the app service identity; no token is placed in frontend code.
No live deployment or permission changes were executed during this local update.

## UI behavior

The opening greeting and three entries use the purple IFC theme. Dashboard opens
the supplied published dashboard in another tab. Quantitative analysis and
4 recommendations send ordinary user requests to the existing Genie agent.

The card renderer accepts a `cards` array in JSON returned by the agent, including
JSON text in its answer. It supports the previously implemented client metrics,
score/weight details, qualitative notes, news links, SQL evidence and More details.
The UI does not force the agent to return this schema. If Genie returns ordinary
text, the original answer is displayed as escaped Markdown. Its actual output
fields may need a deterministic renderer mapping after reviewing a real response;
a second model must not generate or reinterpret the data to fill UI cards.

## Conversation lifetime

History is shown in the browser tab. Server-side Genie conversation IDs use a
bounded cache scoped by app user, Genie Space and browser session. New conversation
or a browser refresh starts a fresh Genie conversation. Idle sessions expire after
one hour; server restarts or eviction require New conversation.

The default single-worker server is supported. A multi-process/multi-instance
deployment needs shared session routing for seamless follow-ups. The app reports
session expiration rather than silently starting a new context on a follow-up.

## Local checks and preview

```powershell
cd apps/agent-risk
python -m unittest discover -s tests -p 'test_*.py'
node tests/test_ui_core.mjs
python -m scripts.preview_ui
```

The UI-only preview is disconnected and says so. Real queries require Databricks
authentication and `uv run start-app` with the Genie resource configured.
The code-level checks use fake SDK responses; they do not claim live Genie access.

References: [Genie app resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/genie),
[Genie SDK API](https://databricks-sdk-py.readthedocs.io/en/stable/workspace/dashboards/genie.html).
