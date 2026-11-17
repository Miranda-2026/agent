# More details: news and supporting reports

The existing Genie agent supplies supporting context from:

- `workspace.ifc_case_comp.external_news`
- `workspace.ifc_case_comp.industry_reports`
- `workspace.ifc_case_comp.regional_risk_reports`

## Databricks setup

1. Open Genie Space `01f1ddf25d881906b7234f566362469b`. In **Configure > Data**,
   add these three tables if they are not already included.
2. In **agent-risk > Settings > Resources**, add each as a **UC table** with
   **Can select** permission. Suggested unique keys: `external-news`,
   `industry-reports`, and `regional-risk-reports`, matching `databricks.yml`.
3. Keep the existing `ifc-genie` binding with **Can run**, plus the app identity's
   required catalog/schema/warehouse access.
4. Update the app's source, redeploy, and reload the page.

For From Git deployments, configure resources in App Settings; editing
`databricks.yml` does not automatically apply those resource declarations.
Alternatively, an authorized owner/admin can review
`scripts/grant_context_read_permissions.sql`. It grants catalog/schema usage
plus SELECT on only the three supplied tables. Verify the app principal before
executing it. No remote grants or Genie configuration changes were performed.

## What the user sees

- Each recommendation's **More details** includes **Related news & reports**.
- Plain-text analysis answers also have a **More details** accordion.
- Opening it asks the existing Genie for supporting records relevant to the
  client, geography and industry, or the original analysis text.
- Research runs in a separate conversation in the same Genie Space. The main
  analysis and displayed scores are preserved. No global analytical prompt or
  second model is added.
- Results show Genie's original explanation, record titles, dates, publishers,
  source URLs, supplied risk labels, and SQL/query evidence. Stored records are
  not presented as a new live-news verification service.
- Results load once and are cached within the current page. Failures have a
  retry control; missing data stays unavailable.

Common title/date/source/link column names are recognized for source cards.
Other returned schemas remain accessible as original Genie text and result
tables. The existing 200-row cap and partial-result disclosure still apply.

## New conversation fix

The entry is a native home link with a dedicated reset handler and a navigation
fallback. Clicking it cancels waiting requests, clears the conversation and
cached details, generates a new session ID, resets weights to equal weights,
returns to the welcome page, shows confirmation and focuses the composer.
Old responses cannot repopulate the new conversation. The entry is also
available on mobile. Static assets revalidate after deployment.

## Verification

Offline checks cover the actual UI module's click/reset behavior, clicks on
child elements, cancellation, fresh sessions, lazy loading, cached reopens,
stale-result rejection, source mapping, safe links/escaping, API routes and
direct Genie transport. UI interaction checks use a DOM facade; live Databricks
execution and browser layout are separate.

```powershell
python -m unittest discover -s tests -p 'test_*.py'
node tests/test_ui_core.mjs
node tests/test_context.mjs
node tests/test_ui_interactions.mjs
```

References: [Genie data configuration](https://docs.databricks.com/aws/en/genie-agents/set-up#manage-data-objects),
[App table resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/tables).
