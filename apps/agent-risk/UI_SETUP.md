# IFC purple workspace

This change supplies the UI for the existing Databricks app. It does not replace
the agent's model, tools, analytical prompt, authentication, or scoring logic.

## Experience

- Welcome: **Hi, how can I help you?** with Dashboard, Quantitative analysis,
  and 4 recommendations entry cards.
- Dark purple navigation, purple accents, light workspace, responsive mobile
  layout, keyboard navigation, and English interface text.
- Dashboard opens the supplied published Databricks dashboard in a separate tab.
  It uses the viewer's existing Databricks access; the UI grants no new access.
- Quantitative questions and recommendation requests go to the same-origin
  `POST /invocations` endpoint, with the ResponsesAgent input/output format.
- Independent recommendation cards use green Continue or red Review / Reduce
  badges, the screenshot's two-column metrics, rationale, and **More details**.
- Details contain factor scores and applied weights, risk metrics, qualitative
  notes, separate news entries and article links, suggested action, and SQL
  evidence when returned by the agent. Missing values display **Unavailable**.
- Four weights default to 25% each. Nonnegative inputs are normalized to 100%.
  Applying changed weights in recommendation mode requests fresh rankings from
  the agent. Old reports retain their original weights.
- Chat history lives in this tab's memory. Refresh or New conversation clears
  it. No new persistence service is introduced.

## Integration and important local limitation

The `agent_server/agent.py` in this checkout is still the generic template
(`You are a helpful assistant.`); its request handlers do not connect IFC data
tools. This UI cannot add a data connection by itself. When applying this UI to
the existing production app, retain that app's actual IFC agent implementation,
prompt, credentials and resource permissions. Do not overwrite production
`agent.py` with this checkout's template.

Changed runtime files:

1. `agent_server/static/index.html`, `styles.css`, `app.mjs`, `core.mjs`.
2. `agent_server/ui.py` registers `/`, `/ui-config`, and `/ui-assets/*`.
3. `agent_server/start_server.py` disables the old chat proxy and calls
   `register_ui(app)` after obtaining the MLflow FastAPI app.
4. `scripts/start_app.py` starts the existing server directly. It no longer
   clones, installs, builds, or launches the default external chat frontend.

For an agent with a customized `start_server.py`, merge the small UI registration
change into it; retain its existing initialization and diagnostics. Keep the
Databricks start command `['uv', 'run', 'start-app']`. UI and API share port 8000.
`CHAT_APP_PORT`, `API_PROXY`, and `CHAT_PROXY_TIMEOUT_SECONDS` from the template
are no longer used by this UI, and can remain in the existing deployment config.
Optional `DASHBOARD_URL` overrides the supplied link (HTTPS only). Do not place
credentials in frontend files or this URL.

The supplied app URL is a deployed address, not workspace API credentials.
No production app was changed or deployed during this local implementation.
The bundle in this checkout still declares `agent-openai-agents-sdk`; before any
Bundle deployment, bind/configure the intended existing `agent-risk` app using
the correct Databricks profile. Do not deploy the unconfigured template bundle
as a replacement for the running IFC agent.

## Response contract

Recommendation requests append a presentation schema to the user message;
the existing analytical instructions remain authoritative. All calculations,
eligibility, client selection, ranking and news retrieval stay in the agent.
The agent returns JSON text in an assistant `output_text` item, or a `cards`
array in `custom_outputs`. The UI also accepts a top-level `cards` array.

The canonical shape is below. `null` means unavailable. The values here are
schema placeholders, not sample portfolio results.

```json
{
  "summary": "Agent-generated summary",
  "limitations": [],
  "cards": [
    {
      "client_id": "Database client ID",
      "client_name": "Database client name",
      "industry": null,
      "product_mix": null,
      "recommendation_status": "CONTINUE",
      "score_type": "Continue Investment Score",
      "final_score": null,
      "applied_weights": {
        "disbursed_amount": 25,
        "internal_risk": 25,
        "environmental_category": 25,
        "product_line": 25
      },
      "factor_scores": {
        "disbursed_amount": {"score": null, "weighted_contribution": null},
        "internal_risk": {"score": null, "weighted_contribution": null},
        "environmental_category": {"score": null, "weighted_contribution": null},
        "product_line": {"score": null, "weighted_contribution": null}
      },
      "quantitative_metrics": {
        "active_disbursed_musd": null,
        "approved_musd": null,
        "estimated_undisbursed_musd": null,
        "weighted_internal_risk": null,
        "environmental_breakdown": null,
        "product_distribution": null,
        "past_due_exposure_musd": null,
        "watchlist_exposure_musd": null,
        "risk_exposure_ratio_pct": null,
        "estimated_ecl_musd": null
      },
      "project_performance": {"active": null, "performing": null, "watchlist": null, "past_due": null},
      "quantitative_rationale": null,
      "qualitative_notes": {"region": null, "country": null, "industry": null, "strategic_collaboration": null, "research_limitations": null},
      "news": [],
      "recommended_action": null,
      "data_quality_flags": [],
      "audit": {"source_table": null, "filters": null, "project_identifiers": null, "methodology": null, "sql": null, "limitations": null}
    }
  ]
}
```

Return two `CONTINUE` and two `REDUCE_REVIEW` cards when enough clients qualify.
Return only verified eligible clients if fewer qualify, with limitations. The
UI flags missing/duplicate IDs, missing or mismatched applied weights, unexpected
card/category counts, and final-score inconsistencies. It does not re-rank
clients, fill missing financial values, or claim to verify SQL results itself.

All `*_musd` fields are numeric millions of USD. All score and percentage fields
use 0–100; risk rating uses 1–6. Each `news` entry has `headline`, `publisher`,
`publication_date`, `relevance`, `risk_classification`, `explanation`, and `url`.
No news is created by the frontend. A text-only agent response is shown as
escaped Markdown, rather than guessing client data from prose.

## Preview and validation

UI only, no credentials or dependencies:

```powershell
cd apps/agent-risk
python -m scripts.preview_ui
```

Open `http://127.0.0.1:8765`. The preview's chat explicitly reports that it is
disconnected; it never supplies fabricated financial results. For real analysis,
run `uv run start-app` in an environment with the existing IFC agent configured.

Checks:

```powershell
python -m unittest discover -s tests -p 'test_*.py'
node tests/test_ui_core.mjs
```

Python route checks require FastAPI and httpx. JavaScript checks use Node built-in
modules only. Full Databricks agent execution, production deployment, and visual
browser verification are separate from these checks. Browser automation ended
because the tool could not reliably determine the current Chrome URL.
