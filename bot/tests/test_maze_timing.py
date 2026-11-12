"""Checks for the maze discount windows, anchored to the 5-12 Nov 2026 event.

Run from `bot/`:  python3 -m unittest discover -s tests -v
"""

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from maze_timing import (  # noqa: E402
    MAZE_DURATION,
    current_window,
    derive_event_start,
    parse_remaining,
    parse_start_date,
    upcoming_windows,
    windows,
    windows_to_fire,
)

IST = timezone(timedelta(hours=5, minutes=30))
EVENT_START = datetime(2026, 11, 5, 16, 30, tzinfo=IST)
EVENT_END = EVENT_START + MAZE_DURATION


def at(hours: float) -> datetime:
    return EVENT_START + timedelta(hours=hours)


class WindowTableTest(unittest.TestCase):
    def test_six_windows_with_expected_boundaries(self):
        table = [(w.percent, w.start, w.end) for w in windows(EVENT_START)]
        self.assertEqual([w[0] for w in table], ["50%", "20%", "10%", "10%", "10%", "20%"])
        self.assertEqual([w[1] for w in table], [at(0), at(5), at(24), at(72), at(120), at(164)])
        self.assertEqual([w[2] for w in table], [at(5), at(13), at(36), at(84), at(132), at(168)])
        self.assertEqual(windows(EVENT_START)[-1].end, EVENT_END)

    def test_current_window_respects_gaps(self):
        self.assertEqual(current_window(EVENT_START, at(2.2)).percent, "50%")
        self.assertEqual(current_window(EVENT_START, at(5)).percent, "20%")
        self.assertEqual(current_window(EVENT_START, at(6.5)).percent, "20%")
        self.assertIsNone(current_window(EVENT_START, at(13)))
        self.assertIsNone(current_window(EVENT_START, at(20)))
        self.assertEqual(current_window(EVENT_START, at(24)).percent, "10%")
        self.assertIsNone(current_window(EVENT_START, at(40)))
        self.assertEqual(current_window(EVENT_START, at(164.7)).percent, "20%")
        self.assertIsNone(current_window(EVENT_START, EVENT_END))

    def test_upcoming_excludes_started(self):
        upcoming = upcoming_windows(EVENT_START, at(6.5))
        self.assertEqual(
            [w.start for w in upcoming], [at(13 + 11), at(72), at(120), at(164)]
        )

    def test_windows_to_fire_arms_future_and_recent_starts_only(self):
        armed = windows_to_fire(EVENT_START, at(0) + timedelta(minutes=2))
        # 50% is within the 5 minute grace, the rest are in the future.
        self.assertEqual(len(armed), 6)
        self.assertEqual(armed[0][1], 0.0)
        self.assertGreater(armed[1][1], 0)

        later = windows_to_fire(EVENT_START, at(6))
        self.assertNotIn("50%", [window.percent for window, _ in later])


class EvidenceTest(unittest.TestCase):
    """Every screenshot's banner must land inside this window table."""

    SHOTS = [
        # (screenshot time, banner percent, banner days, banner hours, banner minutes left)
        (datetime(2026, 11, 5, 18, 42, 16, tzinfo=IST), "50%", 0, 2, 47),
        (datetime(2026, 11, 5, 23, 2, 1, tzinfo=IST), "20%", 0, 6, 28),
        (datetime(2026, 11, 6, 18, 35, 47, tzinfo=IST), "10%", 0, 9, 54),
        (datetime(2026, 11, 8, 17, 4, 43, tzinfo=IST), "10%", 0, 11, 25),
        (datetime(2026, 11, 10, 16, 47, 22, tzinfo=IST), "10%", 0, 11, 42),
        (datetime(2026, 11, 12, 13, 13, 56, tzinfo=IST), "20%", 0, 3, 16),
        (datetime(2026, 11, 12, 13, 14, 23, tzinfo=IST), "20%", 0, 3, 15),
    ]

    def test_banner_matches_live_window_and_end_time(self):
        for shot, percent, days, hours, minutes in self.SHOTS:
            with self.subTest(shot=shot):
                live = current_window(EVENT_START, shot)
                self.assertIsNotNone(live, "screenshot taken during a real discount")
                self.assertEqual(live.percent, percent)
                banner_end = shot + timedelta(days=days, hours=hours, minutes=minutes)
                self.assertLess(abs((banner_end - live.end).total_seconds()), 60)

    def test_countdown_derivation_recovers_the_event_start(self):
        # The maze said "6d 21h 47m" at 18:42:16 on 5 Nov.
        remaining = timedelta(days=6, hours=21, minutes=47)
        derived = derive_event_start(self.SHOTS[0][0], remaining)
        self.assertLess(abs((derived - EVENT_START).total_seconds()), 60)
        self.assertEqual(current_window(derived, self.SHOTS[0][0]).percent, "50%")


class ParsingTest(unittest.TestCase):
    def test_parse_remaining_accepts_game_formats(self):
        self.assertEqual(parse_remaining("6d21h47m"), timedelta(days=6, hours=21, minutes=47))
        self.assertEqual(parse_remaining("6d 12h"), timedelta(days=6, hours=12))
        self.assertEqual(parse_remaining("3h16m"), timedelta(hours=3, minutes=16))
        self.assertEqual(parse_remaining("45m"), timedelta(minutes=45))
        self.assertIsNone(parse_remaining(""))
        self.assertIsNone(parse_remaining("soon"))
        self.assertIsNone(parse_remaining("7"))

    def test_parse_start_date_rolls_forward(self):
        now = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(
            parse_start_date("05/11", now), datetime(2027, 11, 5, 11, 0, tzinfo=timezone.utc)
        )
        self.assertEqual(
            parse_start_date("26/11", now), datetime(2026, 11, 26, 11, 0, tzinfo=timezone.utc)
        )
        self.assertIsNone(parse_start_date("31/02", now))
        self.assertIsNone(parse_start_date("next week", now))


if __name__ == "__main__":
    unittest.main()
