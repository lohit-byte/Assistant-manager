"""Maze Island discount windows.

Derived from the 5-12 Nov 2026 maze (seven in-game screenshots, each discount
banner's countdown agreeing with this table to within ~30 s):

    hours after maze start   discount
    0  .. 5                  50%
    5  .. 13                 20%
    24 .. 36                 10%   (first limited-time path opens at 24 h)
    72 .. 84                 10%   (second path)
    120 .. 132               10%   (third path)
    164 .. 168               20%   (final hours)

Discounts are windows separated by real gaps - there is no discount at all
from 13-24 h, 36-72 h, 84-120 h and 132-164 h.  The maze itself lasts 7 days
(168 h) and starts on a Thursday around 16:30 IST (11:00 UTC).

The old guide-based ladder (20/10/30/10/10/10/10/20 in `SCHEDULE_7D`) was
wrong: 30% never happens and its moments were not the real change points.

Anchoring: the windows are offsets from the event START.  A player who joins
late still sees the same absolute discount times, which is why the bot keeps
one shared event start instead of per-server per-player offsets.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

MAZE_DURATION = timedelta(days=7)

# How long after a window start a restart may still fire the ping ("grace").
PING_GRACE = timedelta(minutes=5)

# (start_hour, end_hour, percent) measured from the maze start.
WINDOWS_7D: tuple[tuple[int, int, str], ...] = (
    (0, 5, "50%"),
    (5, 13, "20%"),
    (24, 36, "10%"),
    (72, 84, "10%"),
    (120, 132, "10%"),
    (164, 168, "20%"),
)

# A maze that starts on a date given without a time starts here (11:00 UTC =
# 16:30 IST), which is what the November event showed.
DEFAULT_START_UTC = (11, 0)


@dataclass(frozen=True)
class DiscountWindow:
    percent: str
    start: datetime
    end: datetime

    def key(self) -> str:
        """Stable identity used to dedupe a ping across restarts."""
        return f"{self.percent}@{int(self.start.timestamp())}"


def windows(event_start: datetime, spec=WINDOWS_7D) -> list[DiscountWindow]:
    """Every discount window of the maze that starts at ``event_start``."""
    return [
        DiscountWindow(
            percent=percent,
            start=event_start + timedelta(hours=start_h),
            end=event_start + timedelta(hours=end_h),
        )
        for start_h, end_h, percent in spec
    ]


def current_window(event_start: datetime, now: datetime, spec=WINDOWS_7D):
    """The discount live at ``now``, or None during a gap."""
    for window in windows(event_start, spec):
        if window.start <= now < window.end:
            return window
    return None


def upcoming_windows(event_start: datetime, now: datetime, spec=WINDOWS_7D):
    """Windows that have not started yet, soonest first."""
    return [window for window in windows(event_start, spec) if window.start > now]


def windows_to_fire(event_start: datetime, now: datetime, spec=WINDOWS_7D):
    """Pings to arm now: one per window start that is in the future or inside the grace period."""
    armed = []
    for window in windows(event_start, spec):
        delay = (window.start - now).total_seconds()
        if delay > 0 or -PING_GRACE.total_seconds() < delay <= 0:
            armed.append((window, max(delay, 0.0)))
    return armed


def derive_event_start(now: datetime, remaining: timedelta) -> datetime:
    """Event start from the in-game countdown ("maze ends in ``remaining``")."""
    return now + remaining - MAZE_DURATION


def parse_remaining(text: str) -> timedelta | None:
    """Parse the in-game countdown: ``6d21h47m``, ``6d 12h``, ``3h16m``, ``45m``."""
    cleaned = (text or "").strip().lower().replace(" ", "")
    match = re.fullmatch(r"(?:(\d{1,2})d)?(?:(\d{1,2})h)?(?:(\d{1,2})m)?", cleaned)
    if not match or not any(match.groups()):
        return None
    days, hours, minutes = (int(part or 0) for part in match.groups())
    return timedelta(days=days, hours=hours, minutes=minutes)


def parse_start_date(text: str, now: datetime) -> datetime | None:
    """Parse ``DD/MM`` or ``DD/MM/YYYY`` into 11:00 UTC, rolling forward if it has passed."""
    match = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?", (text or "").strip())
    if not match:
        return None
    day, month = int(match.group(1)), int(match.group(2))
    year = int(match.group(3)) if match.group(3) else now.year

    for _ in range(40):
        try:
            candidate = datetime(
                year, month, day, DEFAULT_START_UTC[0], DEFAULT_START_UTC[1], tzinfo=timezone.utc
            )
        except ValueError:
            return None
        if candidate + MAZE_DURATION >= now:
            return candidate
        year += 1
    return None


def parse_windows(raw) -> tuple[tuple[int, int, str], ...] | None:
    """Read the JSONB value stored on ``maze_settings.windows`` (None = built-in table)."""
    if not isinstance(raw, list) or not raw:
        return None
    parsed: list[tuple[int, int, str]] = []
    for item in raw:
        try:
            start_h, end_h, percent = item
            parsed.append((int(start_h), int(end_h), str(percent)))
        except (TypeError, ValueError):
            return None
    return tuple(parsed)


def parse_windows_spec(text: str) -> tuple[tuple[int, int, str], ...] | None:
    """`!maze windows set 0-5:50 5-13:20 24-36:10` -> window table."""
    tokens = [token for token in re.split(r"[\s,]+", (text or "").strip()) if token]
    if not tokens:
        return None
    parsed: list[tuple[int, int, str]] = []
    for token in tokens:
        match = re.fullmatch(r"(\d{1,3})-(\d{1,3}):(\d{1,3})%?", token)
        if not match:
            return None
        parsed.append((int(match.group(1)), int(match.group(2)), f"{match.group(3)}%"))
    return tuple(parsed)


def validate_windows(spec, duration: timedelta = MAZE_DURATION) -> str | None:
    """Return a human-readable problem with an edited table, or None when it is usable."""
    hours = int(duration.total_seconds() // 3600)
    if not spec:
        return "the schedule is empty"
    previous_end = 0
    for start_h, end_h, percent in spec:
        if start_h < previous_end:
            return f"{percent} starts at {start_h}h, before the previous discount ends at {previous_end}h"
        if end_h <= start_h:
            return f"{percent} ends at {end_h}h, not after its start at {start_h}h"
        if end_h > hours:
            return f"{percent} ends at {end_h}h, after the {hours}h maze"
        match = re.fullmatch(r"(\d{1,3})%", str(percent))
        if not match or not 1 <= int(match.group(1)) <= 100:
            return f"{percent!r} is not a 1-100% discount"
        previous_end = end_h
    return None
