"""Expose the existing IFC Genie Space through the app's ResponsesAgent API.

There is no second LLM, copied analyst prompt, or model-generated rewrite.
"""

import logging
import os
from typing import AsyncGenerator
from uuid import uuid4

import mlflow
from databricks.sdk import WorkspaceClient
from mlflow.genai.agent_server import get_request_headers, invoke, stream
from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentResponse, ResponsesAgentStreamEvent

from agent_server.genie_client import (
    DEFAULT_GENIE_SPACE_ID,
    ConversationRegistry,
    DirectGenieClient,
    GenieFailure,
    latest_question,
    safe_failure,
)

logger = logging.getLogger(__name__)
conversations = ConversationRegistry()


async def call_existing_agent(request):
    settings = request.custom_inputs or {}
    session_id = settings.get("session_id") or str(uuid4())
    if not isinstance(session_id, str) or len(session_id) > 128:
        raise GenieFailure("GENIE_INVALID_SESSION: Start a new conversation.")
    space_id = os.getenv("IFC_GENIE_SPACE_ID", "").strip() or DEFAULT_GENIE_SPACE_ID
    headers = {key.lower(): value for key, value in (get_request_headers() or {}).items()}
    owner = headers.get("x-forwarded-user") or headers.get("x-forwarded-email") or "local"
    session = conversations.get(owner, space_id, session_id)
    if session.conversation_id is None and sum(item.role == "user" for item in request.input) > 1:
        raise GenieFailure("GENIE_SESSION_EXPIRED: Start a new conversation to continue in Genie.")
    try:
        # SDK authentication uses the existing Databricks app service identity.
        client = WorkspaceClient()
        result = await DirectGenieClient(client, space_id).ask(latest_question(request.input), session)
    except Exception as error:
        issue = safe_failure(error)
        logger.warning("Direct Genie request failed: %s; exception_type=%s", issue, type(error).__name__)
        raise issue from None
    message = {
        "id": "msg_" + uuid4().hex,
        "type": "message",
        "role": "assistant",
        "content": [{"type": "output_text", "text": result["text"] or "Genie returned query results. See the attached table."}],
    }
    return message, {
        "genie": {"space_id": space_id, "conversation_id": result["conversation_id"], "message_id": result["message_id"]},
        "genie_queries": result["queries"],
    }


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    if session_id := (request.custom_inputs or {}).get("session_id"):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    message, metadata = await call_existing_agent(request)
    return ResponsesAgentResponse(output=[message], custom_outputs=metadata)


@stream()
async def stream_handler(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # Genie is polled to completion; this endpoint emits its final response.
    message, metadata = await call_existing_agent(request)
    yield ResponsesAgentStreamEvent(type="response.output_item.done", item=message)
    for query in metadata["genie_queries"]:
        sql = query.get("sql") or "SQL unavailable"
        yield ResponsesAgentStreamEvent(type="response.output_item.done", item={
            "id": "msg_" + uuid4().hex, "type": "message", "role": "assistant",
            "content": [{"type": "output_text", "text": "Genie query:\n```sql\n" + sql + "\n```"}],
        })
