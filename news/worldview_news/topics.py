"""Topic list, read from config/worldview/topics.yaml (never hard-coded)."""

from __future__ import annotations

from pathlib import Path

import yaml


def load_topics(path: Path) -> list[dict]:
    with open(path) as fh:
        data = yaml.safe_load(fh)
    return data["topics"]
