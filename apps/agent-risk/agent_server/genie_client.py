"""Direct transport to the user's existing Genie Space.

This module does not instantiate an LLM, add instructions, or rewrite answers.
It accepts an injected SDK client so transport behavior can be checked offline.
"""

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import timedelta

DEFAULT_GENIE_SPACE_ID = "01f1ddf25d881906b7234f566362469b"
_FAILURES = {"FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"}


class GenieFailure(RuntimeError):
    """Safe diagnostic code; raw SDK exceptions stay out of browser messages."""


class _TerminalMessage(Exception):
    pass


def as_dict(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    return value.model_dump() if hasattr(value, "model_dump") else value.as_dict()


@dataclass
class Conversation:
    conversation_id: str | None = None
    last_used: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class ConversationRegistry:
    """Bounded process-local sessions; no client-selected Genie conversation IDs."""

    def __init__(self, max_sessions=256, ttl_seconds=3600):
        self.sessions = OrderedDict()
        self.max_sessions = max_sessions
        self.ttl_seconds = ttl_seconds

    def get(self, owner, space_id, session_id):
        now = time.monotonic()
        for key, session in list(self.sessions.items()):
            if now - session.last_used > self.ttl_seconds and not session.lock.locked():
                del self.sessions[key]
        key = (owner, space_id, session_id)
        if key not in self.sessions:
            if len(self.sessions) >= self.max_sessions:
                candidate = next((key for key, session in self.sessions.items() if not session.lock.locked()), None)
                if candidate is None:
                    raise GenieFailure("GENIE_BUSY: All conversation slots are currently in use.")
                del self.sessions[candidate]
            self.sessions[key] = Conversation()
        self.sessions.move_to_end(key)
        session = self.sessions[key]
        session.last_used = now
        return session


def latest_question(items):
    for item in reversed(items):
        item = as_dict(item)
        if item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            text = "\n".join(part.get("text", "") for part in content if part.get("type") in {"text", "input_text"})
            if text.strip():
                return text
    raise GenieFailure("GENIE_EMPTY_QUESTION: Provide a message for the existing agent.")


def safe_failure(error):
    if isinstance(error, GenieFailure):
        return error
    code = str(getattr(error, "error_code", "") or type(error).__name__).upper()
    if code in {"PERMISSION_DENIED", "PERMISSIONDENIED", "UNAUTHENTICATED"}:
        return GenieFailure("GENIE_ACCESS_DENIED: The app identity cannot access the Genie Space or its resources.")
    if code in {"NOT_FOUND", "NOTFOUND", "RESOURCE_DOES_NOT_EXIST"}:
        return GenieFailure("GENIE_SPACE_NOT_FOUND: The configured Genie resource was not found.")
    if code in {"TOO_MANY_REQUESTS", "TOOMANYREQUESTS", "RESOURCE_EXHAUSTED"}:
        return GenieFailure("GENIE_RATE_LIMITED: Genie is temporarily rate limited.")
    if isinstance(error, TimeoutError):
        return GenieFailure("GENIE_TIMEOUT: The existing agent did not complete within the request timeout.")
    return GenieFailure("GENIE_REQUEST_FAILED: The Genie request failed. Check the app logs for the request stage.")


class DirectGenieClient:
    def __init__(self, workspace_client, space_id, timeout_seconds=240, row_limit=200):
        self.client = workspace_client
        self.space_id = space_id
        self.timeout = timedelta(seconds=timeout_seconds)
        self.row_limit = row_limit

    async def ask(self, question, conversation):
        async with conversation.lock:
            try:
                return await asyncio.to_thread(self._ask_sync, question, conversation)
            finally:
                conversation.last_used = time.monotonic()

    def _ask_sync(self, question, conversation):
        kwargs = {"space_id": self.space_id, "content": question}
        if conversation.conversation_id:
            waiter = self.client.genie.create_message(conversation_id=conversation.conversation_id, **kwargs)
        else:
            waiter = self.client.genie.start_conversation(**kwargs)
        initial = as_dict(getattr(waiter, "response", None))
        if initial.get("conversation_id"):
            conversation.conversation_id = initial["conversation_id"]
        latest = None

        def capture(message):
            nonlocal latest
            latest = as_dict(message)
            if latest.get("status") in _FAILURES:
                raise _TerminalMessage()

        try:
            message = as_dict(waiter.result(timeout=self.timeout, callback=capture))
        except Exception:
            if latest is None or latest.get("status") not in _FAILURES:
                raise
            message = latest
        message = {**initial, **message}
        conversation.conversation_id = message.get("conversation_id") or conversation.conversation_id
        if message.get("status") != "COMPLETED":
            # A FAILED status alone does not establish an authorization problem.
            status = message.get("status") or "UNKNOWN"
            error_type = (message.get("error") or {}).get("type") or "UNKNOWN"
            raise GenieFailure(
                f"GENIE_{status}: Genie did not complete this message. "
                f"conversation_id={conversation.conversation_id}, "
                f"message_id={message.get('message_id') or message.get('id')}, error_type={error_type}"
            )
        message_id = message.get("message_id") or message.get("id")
        result = {"text": [], "queries": [], "conversation_id": conversation.conversation_id, "message_id": message_id}
        for attachment in message.get("attachments") or []:
            text = (attachment.get("text") or {}).get("content")
            if isinstance(text, str):
                result["text"].append(text)
            query = attachment.get("query")
            if not query:
                continue
            evidence = {"sql": query.get("query"), "description": query.get("description"), "columns": [], "rows": [], "data_available": False, "truncated": True}
            attachment_id = attachment.get("attachment_id")
            if attachment_id and message_id and conversation.conversation_id:
                try:
                    response = self.client.genie.get_message_attachment_query_result(
                        space_id=self.space_id, conversation_id=conversation.conversation_id,
                        message_id=message_id, attachment_id=attachment_id,
                    )
                    statement = as_dict(response).get("statement_response") or {}
                    manifest = statement.get("manifest") or {}
                    rows = (statement.get("result") or {}).get("data_array")
                    data = statement.get("result") or {}
                    total = manifest.get("total_row_count")
                    succeeded = (statement.get("status") or {}).get("state") == "SUCCEEDED"
                    available = succeeded and (isinstance(rows, list) or total == 0)
                    shown = rows[:self.row_limit] if available and isinstance(rows, list) else []
                    evidence.update({
                        "columns": [col.get("name", "") for col in (manifest.get("schema") or {}).get("columns") or []],
                        "rows": shown, "data_available": available, "total_row_count": total,
                        "truncated": bool(not available or manifest.get("truncated") or (query.get("query_result_metadata") or {}).get("is_truncated") or data.get("next_chunk_index") is not None or data.get("next_chunk_internal_link") or (manifest.get("total_chunk_count") or 0) > 1 or (isinstance(total, int) and total > len(shown)) or (isinstance(rows, list) and len(rows) > self.row_limit)),
                    })
                except Exception:
                    evidence["error"] = "GENIE_QUERY_RESULT_UNAVAILABLE"
            # Deliberately exclude signed external result/download URLs.
            result["queries"].append(evidence)
        result["text"] = "\n\n".join(result["text"])
        if not result["text"] and not result["queries"]:
            raise GenieFailure("GENIE_EMPTY_RESPONSE: Genie returned no text or query attachments.")
        return result
