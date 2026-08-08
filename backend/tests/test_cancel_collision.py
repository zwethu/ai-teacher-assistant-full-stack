"""A run that dies on arrival right after a Stop is not its own fault.

Stop cannot abort the Agent Engine invocation in flight, so the orphaned run
keeps writing to the shared session for a while, and a new run started into it
fails on its first call. Measured live: cancel at 05:14:25, resend failed
05:15:14→17, orphan wound down 05:15:23, and the identical retry at 05:15:40
succeeded. The gateway now recognises that shape — nothing streamed plus a
cancel moments ago — waits for the orphan, and retries; if the window never
clears it says what actually happened instead of "Unexpected backend error".
"""

import unittest
from unittest.mock import AsyncMock, patch

from services import agent_gateway


def _patches(stack, *, recent_cancel: bool):
    """The shared harness: everything external stubbed, delays zeroed."""
    events: list[dict] = []
    statuses: list[str] = []
    marks: dict = {"failed_error": None, "messages": []}

    def record_event(_run_id, **kwargs):
        # emit_backend_event is a closure over write_run_event; the event_type
        # kwarg it forwards is the observable.
        events.append({"event_type": kwargs.get("event_type"), **kwargs})

    def mark_failed(**kwargs):
        marks["failed_error"] = kwargs.get("error")

    def add_message(_b, _c, _role, content, _u, **_k):
        marks["messages"].append(content)
        return {"message_id": "m1"}

    for target in [
        patch.object(agent_gateway, "get_agent_engine_resource_name",
                     return_value="projects/p/locations/l/reasoningEngines/e"),
        patch.object(agent_gateway, "get_agent_session_state", new=AsyncMock(return_value={})),
        patch.object(agent_gateway, "is_agent_run_cancelled", return_value=False),
        patch.object(agent_gateway, "chat_has_recent_cancelled_run", return_value=recent_cancel),
        patch.object(agent_gateway, "COLLISION_RETRY_DELAYS", (0, 0)),
        patch.object(agent_gateway, "TRANSIENT_RETRY_DELAYS", (0, 0, 0)),
        patch.object(agent_gateway, "write_stream_delta"),
        patch.object(agent_gateway, "write_stream_meta"),
        patch.object(agent_gateway, "write_run_event", side_effect=record_event),
        patch.object(agent_gateway, "write_run_error"),
        patch.object(agent_gateway, "write_final_message"),
        patch.object(agent_gateway, "finalize_open_run_steps"),
        patch.object(agent_gateway, "persist_agent_run_timeline"),
        patch.object(agent_gateway, "mark_agent_run_done"),
        patch.object(agent_gateway, "mark_agent_run_failed", side_effect=mark_failed),
        patch.object(agent_gateway, "add_message", side_effect=add_message),
        patch.object(agent_gateway, "set_run_status", side_effect=lambda _r, s: statuses.append(s)),
    ]:
        stack.enter_context(target)
    return events, statuses, marks


async def _invoke():
    await agent_gateway._run_agent_background(
        run_id="run-x",
        rtdb_run_path="agentRuns/run-x",
        batch_id="b1",
        chat_id="c1",
        agent_session_id="s1",
        lecturer_id="u1",
        user_message="Generate the week 1 lesson plan",
        session_state={"workflow_type": "", "save_draft": False, "pending_artifact": False},
    )


class CollisionRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_and_succeeds_once_the_orphan_clears(self):
        # First attempt dies the way the live one did; the retry finds the
        # session consistent again and streams normally.
        calls = {"n": 0}

        def make_stream(**_kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("400 INVALID_ARGUMENT: contents are not valid")

            async def ok():
                yield "Here is the plan."

            return ok()

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, marks = _patches(stack, recent_cancel=True)
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", make_stream))
            await _invoke()

        self.assertEqual(calls["n"], 2)
        self.assertIn("done", statuses)
        self.assertNotIn("failed", statuses)
        self.assertIsNone(marks["failed_error"])
        # The wait is visible, not silent.
        self.assertIn("run.retrying", [e["event_type"] for e in events])

    async def test_exhausted_retries_say_what_happened(self):
        def always_fail(**_kwargs):
            raise RuntimeError("400 INVALID_ARGUMENT: contents are not valid")

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, marks = _patches(stack, recent_cancel=True)
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", always_fail))
            await _invoke()

        self.assertIn("failed", statuses)
        self.assertIn("winding down", str(marks["failed_error"]))
        self.assertNotIn("Unexpected backend error", str(marks["failed_error"]))
        # Initial attempt + one retry per delay slot.
        self.assertEqual(
            [e["event_type"] for e in events].count("run.retrying"),
            len(agent_gateway.COLLISION_RETRY_DELAYS),
        )

    async def test_no_recent_cancel_means_no_retry_and_the_plain_error(self):
        calls = {"n": 0}

        def always_fail(**_kwargs):
            calls["n"] += 1
            raise RuntimeError("something genuinely broke")

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, marks = _patches(stack, recent_cancel=False)
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", always_fail))
            await _invoke()

        self.assertEqual(calls["n"], 1)
        self.assertIn("failed", statuses)
        self.assertEqual(marks["failed_error"], "Unexpected backend error.")
        self.assertNotIn("run.retrying", [e["event_type"] for e in events])

    async def test_a_run_that_raised_because_it_was_stopped_settles_cancelled(self):
        # The agent-side cancel callback ends the invocation, and teardown can
        # surface as an exception before the watcher's next poll. The lecturer
        # stopped it, so it is cancelled — and above all it must not reach the
        # collision retry, which would resurrect a run they just killed.
        calls = {"n": 0}

        def teardown_noise(**_kwargs):
            calls["n"] += 1
            raise RuntimeError("stream torn down mid-invocation")

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, marks = _patches(stack, recent_cancel=True)
            stack.enter_context(
                patch.object(agent_gateway, "is_agent_run_cancelled", return_value=True)
            )
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", teardown_noise))
            await _invoke()

        self.assertEqual(calls["n"], 1)
        self.assertIn("cancelled", statuses)
        self.assertNotIn("failed", statuses)
        self.assertIsNone(marks["failed_error"])
        self.assertNotIn("run.retrying", [e["event_type"] for e in events])

    async def test_a_failure_mid_answer_is_not_a_collision(self):
        # Once text has streamed the session accepted the run; retrying would
        # double-generate the answer. The guard is arrivals only.
        def stream_then_die(**_kwargs):
            async def gen():
                yield "Half an answer"
                raise RuntimeError("connection reset")

            return gen()

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, _marks = _patches(stack, recent_cancel=True)
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", stream_then_die))
            await _invoke()

        self.assertIn("failed", statuses)
        self.assertNotIn("run.retrying", [e["event_type"] for e in events])


class TransientRetryTests(unittest.IsolatedAsyncioTestCase):
    """429/quota/5xx at arrival retry automatically, with Stop as the way out.

    The lecturer used to get "The AI service is at capacity right now … please
    try again" and a dead run; capacity blips usually clear inside a minute, so
    the gateway now waits them out itself. The run stays status="running"
    throughout, which is what keeps the composer's Stop button alive.
    """

    async def test_a_429_retries_and_succeeds_when_capacity_returns(self):
        calls = {"n": 0}

        def flaky_stream(**_kwargs):
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded for model")

            async def ok():
                yield "Here is the plan."

            return ok()

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, marks = _patches(stack, recent_cancel=False)
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", flaky_stream))
            await _invoke()

        self.assertEqual(calls["n"], 3)
        self.assertIn("done", statuses)
        self.assertIsNone(marks["failed_error"])
        retrying = [e for e in events if e["event_type"] == "run.retrying"]
        self.assertEqual(len(retrying), 2)
        # On the thinking line, where the lecturer is already looking — a
        # message-kind event renders nowhere in the frontend.
        self.assertTrue(all(e.get("kind") == "thinking" for e in retrying))
        self.assertIn("Press Stop", str(retrying[0].get("title")))

    async def test_exhausted_capacity_retries_fail_with_the_capacity_message(self):
        def always_429(**_kwargs):
            raise RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded for model")

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, marks = _patches(stack, recent_cancel=False)
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", always_429))
            await _invoke()

        self.assertIn("failed", statuses)
        self.assertIn("at capacity", str(marks["failed_error"]))
        self.assertEqual(
            [e["event_type"] for e in events].count("run.retrying"),
            len(agent_gateway.TRANSIENT_RETRY_DELAYS),
        )

    async def test_stop_during_the_backoff_wins(self):
        # The backoff is the one stretch the stream watcher cannot cover. A
        # cancel flag that flips mid-wait must settle the run as cancelled and
        # not fire the retry.
        calls = {"n": 0}

        def always_429(**_kwargs):
            calls["n"] += 1
            raise RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded")

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, marks = _patches(stack, recent_cancel=False)
            # Not cancelled while streaming; cancelled by the time the backoff
            # polls — i.e. the lecturer pressed Stop during the failure/wait.
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", always_429))
            stack.enter_context(
                patch.object(
                    agent_gateway,
                    "_sleep_unless_cancelled",
                    new=AsyncMock(return_value=True),
                )
            )
            await _invoke()

        self.assertEqual(calls["n"], 1)
        self.assertIn("cancelled", statuses)
        self.assertNotIn("failed", statuses)
        self.assertIsNone(marks["failed_error"])

    async def test_a_429_mid_answer_does_not_retry(self):
        def stream_then_429(**_kwargs):
            async def gen():
                yield "Half an answer"
                raise RuntimeError("429 RESOURCE_EXHAUSTED mid-stream")

            return gen()

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, _marks = _patches(stack, recent_cancel=False)
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", stream_then_429))
            await _invoke()

        self.assertIn("failed", statuses)
        self.assertNotIn("run.retrying", [e["event_type"] for e in events])

    async def test_a_recent_cancel_outranks_the_transient_classification(self):
        # A 429 seconds after a Stop is almost always the orphan, not real
        # capacity pressure — it takes the collision policy and its message.
        def always_429(**_kwargs):
            raise RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded")

        from contextlib import ExitStack
        with ExitStack() as stack:
            events, statuses, marks = _patches(stack, recent_cancel=True)
            stack.enter_context(patch.object(agent_gateway, "stream_agent_response", always_429))
            await _invoke()

        self.assertIn("failed", statuses)
        self.assertIn("winding down", str(marks["failed_error"]))
        retrying = [e for e in events if e["event_type"] == "run.retrying"]
        # Collision budget (2), not transient budget (3).
        self.assertEqual(len(retrying), len(agent_gateway.COLLISION_RETRY_DELAYS))


class SleepUnlessCancelledTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_immediately_when_already_cancelled(self):
        with patch.object(agent_gateway, "is_agent_run_cancelled", return_value=True):
            cancelled = await agent_gateway._sleep_unless_cancelled(
                60, batch_id="b1", chat_id="c1", run_id="r1"
            )
        self.assertTrue(cancelled)

    async def test_waits_out_the_delay_when_never_cancelled(self):
        with patch.object(agent_gateway, "is_agent_run_cancelled", return_value=False):
            cancelled = await agent_gateway._sleep_unless_cancelled(
                0, batch_id="b1", chat_id="c1", run_id="r1"
            )
        self.assertFalse(cancelled)

    async def test_notices_a_cancel_partway_through(self):
        answers = iter([False, True])
        with patch.object(
            agent_gateway, "is_agent_run_cancelled", side_effect=lambda **_k: next(answers)
        ):
            cancelled = await agent_gateway._sleep_unless_cancelled(
                0.05, batch_id="b1", chat_id="c1", run_id="r1"
            )
        self.assertTrue(cancelled)

    async def test_a_failing_poll_does_not_abort_the_wait(self):
        # Fail-open: an RTDB/Firestore blip during the backoff must not turn
        # into a cancelled run.
        with patch.object(
            agent_gateway, "is_agent_run_cancelled", side_effect=RuntimeError("firestore down")
        ):
            cancelled = await agent_gateway._sleep_unless_cancelled(
                0, batch_id="b1", chat_id="c1", run_id="r1"
            )
        self.assertFalse(cancelled)


if __name__ == "__main__":
    unittest.main()
