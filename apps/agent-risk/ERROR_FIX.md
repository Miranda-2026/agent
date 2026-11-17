# Repair the reported agent-risk HTTP 500

The supplied log shows the UI's `/invocations` request reaching `Runner.run()`.
The model request then fails with `404 ENDPOINT_NOT_FOUND`. This checkout was
calling the template model `databricks-claude-sonnet-5-5`. The user confirmed
GPT OSS 120B as the intended model.

A separate background trace export fails because the app service principal
cannot SELECT `workspace.ifc_case_comp.665854304075459_otel_spans`. This trace
permission error is distinct from the failed model request. Logging in again
does not grant the missing table permission.

## Code changes

- `agent_server/model_config.py` defaults to `databricks-gpt-oss-120b` and allows
  `DATABRICKS_MODEL_ENDPOINT` (or legacy `IFC_MODEL_ENDPOINT`) to override it.
- `agent_server/agent.py` reads that configuration instead of the old model name.
  Its existing agent instructions and tools are otherwise unchanged.
- `app.yaml` resolves `DATABRICKS_MODEL_ENDPOINT` from resource key `llm-endpoint`.
- `databricks.yml` uses the same resource for the runtime model and CAN_QUERY
  permission, and declares the exact trace spans table confirmed in the log.
- The frontend recognizes MLflow-wrapped endpoint and permission errors and
  displays a useful message without exposing raw exception bodies.

## Apply to the existing app (From Git or source deployment)

1. Open **agent-risk > Settings > Resources**.
2. Add or edit the **Model / Model serving endpoint** resource. Select your
   existing **GPT OSS 120B** endpoint, normally `databricks-gpt-oss-120b`, with
   **Can query** permission. Set its resource key to **`llm-endpoint`** so it
   matches `app.yaml`. If you use a custom deployment name, select that actual
   endpoint; do not enter the display label `gpt oss 120B` as the model name.
3. Add a **UC table** resource for the confirmed table
   `workspace.ifc_case_comp.665854304075459_otel_spans`. Select **Can select and
   modify**. Inspect the experiment's actual trace location and grant the same
   privileges for any other trace tables it actually uses (annotations, logs,
   metrics). Do not assume the other tables exist or recreate them.
4. Retain the existing **experiment** resource used by `MLFLOW_EXPERIMENT_ID`.
5. Deploy the updated source to the same `agent-risk` app, then hard-refresh
   the browser to load the updated JavaScript. Test a short message first;
   then test quantitative analysis and recommendations.

Editing `databricks.yml` alone does not apply its resources to an app deployed
through **From Git**. Apply those resources in the App settings as above.
For a Bundle-managed app, bind the intended existing app and deploy the bundle
with its configured profile. This checkout's template bundle app name still
needs that binding/configuration; do not accidentally deploy a new template app.

An authorized owner/admin can alternatively use
`scripts/grant_trace_permissions.sql` to repair the confirmed trace-table
privileges. The script identifies the app service principal from the supplied
log and grants only catalog/schema usage plus that table's SELECT and MODIFY.
No permission changes have been executed by this local code update.

## Separate IFC integration limitation

This checkout's `create_agent()` still uses `You are a helpful assistant.` and
only the current-time tool; its MCP connection examples are not enabled in the
request handlers. Correcting the model endpoint restores the ability to call
the selected model, but does not connect IFC portfolio data or a news source.
Retain your production IFC agent implementation when applying these changes.
If production is running this exact template, the data-agent connection and
analytical prompt still need to be configured before real recommendations can
be generated. Do not treat a successful greeting as verification of SQL access.

## References

- [Databricks GPT OSS 120B endpoint name](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models)
- [Model resource permissions and endpoint configuration](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/model-serving)
- [App table resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/tables)
- [Trace table privilege requirements](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/trace-unity-catalog#grant-permissions)
