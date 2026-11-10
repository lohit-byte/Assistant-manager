"""Bundled race node sheet loader.

The owner drops one ``nodesheet.json`` next to the bot (or points
``NODESHEET_PATH`` at it) and every server falls back to it when a race channel
has no active per-server sheet. No discord imports: the offline tests import
this module directly.

Sheet shape (same JSON the race page edits)::

    {"0.1": {"ofa": "OFA task text", "dyp": "DYP task text", "je": "JE task text"}}

An optional top-level ``{"nodes": {...}}`` wrapper is accepted.
"""

import json
import os
import re
import threading

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_FIELDS = ("ofa", "dyp", "je")

# mtime cache: {path: (mtime, nodes)}
_cache = {}
_lock = threading.Lock()


def default_path() -> str:
    """Resolve the bundled sheet path.

    Order: ``NODESHEET_PATH`` → ``<repo>/nodesheet.json`` if it exists →
    ``<cwd>/nodesheet.json`` if it exists → ``<repo>/nodesheet.json``. The
    working-directory fallback matters for the Docker image, which copies the
    bot package into ``/app`` so there is no repo-root file next to it.
    """
    configured = (os.getenv("NODESHEET_PATH") or "").strip()
    if configured:
        return configured
    repo_path = os.path.join(ROOT_DIR, "nodesheet.json")
    if os.path.isfile(repo_path):
        return repo_path
    cwd_path = os.path.join(os.getcwd(), "nodesheet.json")
    if os.path.isfile(cwd_path):
        return cwd_path
    return repo_path


def parse_nodesheet(payload):
    """Validate and normalise a node sheet payload.

    Returns ``(nodes, warnings)``. Raises ``ValueError`` only when the whole
    payload is unusable (top level, or the ``nodes`` wrapper, is not an object);
    a single malformed node is skipped with a warning so the remaining nodes
    stay usable.
    """
    if not isinstance(payload, dict):
        raise ValueError("expected an object keyed by `lap.node`")
    nodes = payload.get("nodes", payload)
    if not isinstance(nodes, dict):
        raise ValueError("expected 'nodes' to be an object keyed by `lap.node`")

    data, warnings = {}, []
    for raw_key, raw_node in nodes.items():
        key = str(raw_key).strip()
        # Race commands only generate lap.<1-5>; anything else is unreachable and
        # would look like a valid sheet while silently doing nothing.
        if not re.fullmatch(r"\d+\.[1-5]", key):
            warnings.append(f"node `{raw_key}` skipped: expected a `lap.<1-5>` key")
            continue
        if not isinstance(raw_node, dict):
            warnings.append(f"node `{key}` skipped: task must be an object")
            continue
        missing = [field for field in NODE_FIELDS if field not in raw_node]
        if missing:
            warnings.append(f"node `{key}` skipped: missing {', '.join(missing)}")
            continue
        if not all(isinstance(raw_node[field], str) for field in NODE_FIELDS):
            warnings.append(f"node `{key}` skipped: ofa, dyp and je must be strings")
            continue
        data[key] = {field: raw_node[field] for field in NODE_FIELDS}
    return data, warnings


def _read(path):
    # utf-8-sig tolerates a BOM the owner's editor may leave behind.
    with open(path, "r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def load_nodesheet(path=None):
    """Load the bundled sheet (cached by mtime); ``None`` when unusable.

    Never raises: a missing, unreadable or malformed file just disables the
    bundled fallback so a race command keeps working with per-server sheets.
    """
    target = path or default_path()
    try:
        mtime = os.path.getmtime(target)
    except OSError:
        return None
    with _lock:
        cached = _cache.get(target)
        if cached and cached[0] == mtime:
            return cached[1]
    try:
        data, warnings = parse_nodesheet(_read(target))
    except (OSError, UnicodeDecodeError, ValueError, TypeError) as e:
        print(f"Bundled node sheet ignored ({target}): {e}")
        return None
    for warning in warnings:
        print(f"Bundled node sheet warning: {warning}")
    if not data:
        print(f"Bundled node sheet ignored ({target}): no usable nodes")
        return None
    with _lock:
        _cache[target] = (mtime, data)
    return data


def bundled_sheet():
    """The bundled node sheet, or ``None`` when the host has no usable file."""
    return load_nodesheet()
