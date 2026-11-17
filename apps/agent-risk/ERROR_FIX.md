# Current resolution of the reported HTTP 500

The supplied log showed a template model call failing with ENDPOINT_NOT_FOUND.
It also showed a separate trace-export permission error. The user clarified that
all actual responses must come from their existing Genie Space, not a separate
foundation model using a copied prompt.

The app now calls that Genie Space directly. The previous GPT OSS endpoint fix
is superseded: no model endpoint or llm-endpoint binding is used by the runtime.
No analyst prompt, scoring formula, eligibility screen or output-format prompt
is injected into the existing agent.

## Required app resources

- **ifc-genie**: the existing space `01f1ddf25d881906b7234f566362469b`, **Can run**.
  `app.yaml` injects its ID as `IFC_GENIE_SPACE_ID`.
- The app identity's required access to the Genie's configured tables/warehouse.
- **experiment**: the existing MLflow tracing experiment.
- The experiment's actual trace tables, with SELECT and MODIFY as required.

For From Git deployments, select these in **agent-risk > Settings > Resources**
then deploy the updated source. The UI and API retain `uv run start-app` and port
8000. The Genie Space's own instructions and configuration are not changed.

## Trace permission error

The confirmed missing table in the log is:
`workspace.ifc_case_comp.665854304075459_otel_spans`.

Add it as an App **UC table** resource with **Can select and modify**. Inspect the
experiment's actual trace location and grant the same access to any annotations,
logs and metrics tables it actually uses. Do not recreate tables or grant broad
access to the portfolio schema. Logging in again does not grant table privileges.

Alternatively, an authorized owner/admin can use
`scripts/grant_trace_permissions.sql` for the exact confirmed table. It identifies
the agent-risk service principal from the supplied log; verify that identity
before executing. No remote permission grants have been executed by this update.

## Verification status

Local checks verify unchanged question forwarding, original answer preservation,
Genie follow-ups, isolated sessions, terminal failures, bounded query evidence,
HTML escaping, and UI/API routes. Live execution still requires the App resource
bindings and an authenticated Databricks environment. An unknown Genie FAILED
status is not automatically described as an access or data-connection failure.

See [UI_SETUP.md](UI_SETUP.md) for the complete current integration behavior.

References: [Genie resource permissions](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/genie),
[Trace table permissions](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/trace-unity-catalog#grant-permissions).
