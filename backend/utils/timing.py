"""Structured duration logging, matching the `event=... duration_ms=...` convention."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Iterator


@contextmanager
def log_span(logger: logging.Logger, event: str, **fields: object) -> Iterator[None]:
    started = time.perf_counter()
    try:
        yield
    finally:
        suffix = "".join(f" {key}={value}" for key, value in fields.items())
        logger.info(
            "event=%s duration_ms=%d%s",
            event,
            int((time.perf_counter() - started) * 1000),
            suffix,
        )
