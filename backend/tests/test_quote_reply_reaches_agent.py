"""A quoted passage must survive the path to the agent, unmodified.

The lecturer selects part of an earlier response and replies to it; that excerpt
has to reach Agent Engine or the feature is cosmetic. Message `content` is the
only channel — run_agent_task replays the stashed `user_message` string and
nothing else from the message reaches the agent, which is why the quote is
carried as a line inside the body rather than as a side field.
"""

from unittest.mock import MagicMock  # noqa: F401  (house pattern for gw stubs)

import asyncio

from services import agent_gateway as gw

QUOTE_LINE = (
    'In reply to this part of your earlier response: "exported to Google Forms"'
)
SENT_CONTENT = f"{QUOTE_LINE}\n\ncan you redo that part for week 4?"


def test_run_agent_task_replays_the_quote_verbatim(monkeypatch):
    """Drives the real dispatch path: whatever was stashed as user_message is
    what the agent is invoked with, quote line intact."""
    monkeypatch.setattr(gw, "claim_run_dispatch", lambda **k: True)
    monkeypatch.setattr(gw, "set_run_status", lambda *a: None)
    monkeypatch.setattr(gw, "read_run_doc", lambda **k: {
        "rtdb_run_path": "agentRuns/run1",
        "agent_session_id": "s1",
        "lecturer_id": "l1",
        "dispatch_payload": {
            "session_state": {"batch_id": "b1"},
            "user_message": SENT_CONTENT,
        },
    })

    delivered: dict = {}

    async def fake_background(**kwargs):
        delivered.update(kwargs)

    monkeypatch.setattr(gw, "_run_agent_background", fake_background)

    asyncio.run(gw.run_agent_task("b1", "c1", "run1"))

    assert delivered["user_message"] == SENT_CONTENT
    assert QUOTE_LINE in delivered["user_message"], "quote dropped before the agent"
