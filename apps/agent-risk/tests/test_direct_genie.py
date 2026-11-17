"""Direct Genie transport checks using SDK-shaped fakes, with no LLM or network."""

import unittest
from types import SimpleNamespace

from agent_server.genie_client import (
    Conversation, ConversationRegistry, DirectGenieClient, GenieFailure,
    latest_question, safe_failure,
)


class FakeWait:
    def __init__(self, message):
        self.response = {"conversation_id": message.get("conversation_id")}
        self.message = message

    def result(self, timeout, callback):
        callback(self.message)
        return self.message


class FakeGenie:
    def __init__(self, message=None, query_result=None):
        self.message = message or {
            "status": "COMPLETED", "conversation_id": "conversation-1", "message_id": "message-1",
            "content": "User input must never become the agent answer.",
            "attachments": [{"text": {"content": "The existing agent's original answer."}}],
        }
        self.query_result = query_result or {}
        self.calls = []

    def start_conversation(self, **kwargs):
        self.calls.append(("start", kwargs))
        return FakeWait(self.message)

    def create_message(self, **kwargs):
        self.calls.append(("followup", kwargs))
        return FakeWait(self.message)

    def get_message_attachment_query_result(self, **kwargs):
        self.calls.append(("result", kwargs))
        return self.query_result


class DirectGenieTest(unittest.IsolatedAsyncioTestCase):
    async def test_question_and_answer_are_preserved_and_followups_use_genie_context(self):
        genie = FakeGenie()
        client = DirectGenieClient(SimpleNamespace(genie=genie), "provided-space")
        session = Conversation()
        question = "Why this client?\n请解释原因。"
        answer = await client.ask(question, session)
        self.assertEqual(answer["text"], "The existing agent's original answer.")
        self.assertEqual(genie.calls[0], ("start", {"space_id": "provided-space", "content": question}))
        await client.ask("What about its risk?", session)
        self.assertEqual(genie.calls[1], ("followup", {"space_id": "provided-space", "conversation_id": "conversation-1", "content": "What about its risk?"}))

    async def test_query_rows_are_bounded_and_signed_links_are_not_forwarded(self):
        message = {"status": "COMPLETED", "conversation_id": "c", "message_id": "m", "attachments": [
            {"query": {"query": "SELECT value FROM example", "query_result_metadata": None}, "attachment_id": "a"},
        ]}
        query_result = {"statement_response": {
            "status": {"state": "SUCCEEDED"},
            "manifest": {"schema": {"columns": [{"name": "value"}]}, "total_row_count": 3},
            "result": {"data_array": [["1"], ["2"], ["3"]], "external_links": [{"external_link": "https://private.example/signed-token"}]},
        }}
        genie = FakeGenie(message, query_result)
        client = DirectGenieClient(SimpleNamespace(genie=genie), "space", row_limit=2)
        answer = await client.ask("Show data", Conversation())
        evidence = answer["queries"][0]
        self.assertEqual(evidence["rows"], [["1"], ["2"]])
        self.assertEqual(evidence["columns"], ["value"])
        self.assertTrue(evidence["truncated"])
        self.assertTrue(evidence["data_available"])
        self.assertNotIn("signed-token", str(answer))

    async def test_terminal_failure_does_not_manufacture_an_answer(self):
        genie = FakeGenie({"status": "FAILED", "conversation_id": "c", "message_id": "m"})
        with self.assertRaisesRegex(GenieFailure, "GENIE_FAILED"):
            await DirectGenieClient(SimpleNamespace(genie=genie), "space").ask("Question", Conversation())

    async def test_missing_attachment_ids_do_not_trigger_query_calls(self):
        genie = FakeGenie({"status": "COMPLETED", "conversation_id": "c", "message_id": "m", "attachments": [{"query": {"query": "SELECT 1"}}]})
        answer = await DirectGenieClient(SimpleNamespace(genie=genie), "space").ask("Question", Conversation())
        self.assertFalse(answer["queries"][0]["data_available"])
        self.assertEqual(len(genie.calls), 1)

    async def test_user_and_browser_sessions_are_isolated(self):
        registry = ConversationRegistry(max_sessions=3)
        first = registry.get("alice", "space", "tab")
        first.conversation_id = "alice-conversation"
        self.assertIs(registry.get("alice", "space", "tab"), first)
        self.assertIsNone(registry.get("bob", "space", "tab").conversation_id)
        self.assertIsNone(registry.get("alice", "space", "another-tab").conversation_id)
        first.last_used = 0
        self.assertIsNone(registry.get("alice", "space", "tab").conversation_id)

    def test_pydantic_style_message_input_is_supported(self):
        class Input:
            def model_dump(self):
                return {"role": "user", "content": [{"type": "input_text", "text": "Original question"}]}
        self.assertEqual(latest_question([Input(), {"role": "assistant", "content": "Old answer"}]), "Original question")

    def test_sdk_errors_are_mapped_without_returning_private_details(self):
        error = RuntimeError("private details")
        error.error_code = "PERMISSION_DENIED"
        issue = safe_failure(error)
        self.assertIn("GENIE_ACCESS_DENIED", str(issue))
        self.assertNotIn("private details", str(issue))
        self.assertIn("GENIE_TIMEOUT", str(safe_failure(TimeoutError())))
        self.assertIn("GENIE_REQUEST_FAILED", str(safe_failure(RuntimeError())))


if __name__ == "__main__":
    unittest.main()
