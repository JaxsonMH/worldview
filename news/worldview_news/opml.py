"""Read and write OPML, the standard "list of feeds" file every RSS reader understands.

Our layout: one <outline> per folder, each holding <outline type="rss"> feeds.
The `category` attribute carries the feed's default topic.
"""

from __future__ import annotations

import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path


def read_opml(path: Path | str) -> list[dict]:
    return _feeds_from(ET.parse(path).getroot())


def read_opml_text(text: str) -> list[dict]:
    return _feeds_from(ET.fromstring(text))


def _feeds_from(root: ET.Element) -> list[dict]:
    feeds = []

    def walk(node: ET.Element, folder: str | None) -> None:
        for child in node.findall("outline"):
            url = child.get("xmlUrl")
            if url:
                feeds.append({
                    "url": url,
                    "title": child.get("title") or child.get("text") or url,
                    "folder": folder,
                    "default_topic": child.get("category"),
                    "enabled": child.get("enabled", "true") != "false",
                })
            else:
                walk(child, child.get("title") or child.get("text"))

    body = root.find("body")
    if body is None:
        raise ValueError("no <body> in OPML")
    walk(body, None)
    return feeds


def import_feeds(conn: sqlite3.Connection, feeds: list[dict]) -> tuple[int, int]:
    """Add new feeds; update title/folder/topic of ones we already have. Returns (added, updated)."""
    added = updated = 0
    for f in feeds:
        existed = conn.execute("SELECT 1 FROM feeds WHERE url = ?", (f["url"],)).fetchone()
        conn.execute(
            """INSERT INTO feeds (url, title, folder, default_topic, enabled) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(url) DO UPDATE SET title=excluded.title, folder=excluded.folder,
                 default_topic=excluded.default_topic, enabled=excluded.enabled""",
            (f["url"], f["title"], f["folder"], f["default_topic"], int(f["enabled"])),
        )
        if existed:
            updated += 1
        else:
            added += 1
    conn.commit()
    return added, updated


def export_opml(conn: sqlite3.Connection) -> str:
    root = ET.Element("opml", version="2.0")
    ET.SubElement(ET.SubElement(root, "head"), "title").text = "Worldview feeds"
    body = ET.SubElement(root, "body")
    folders: dict[str, ET.Element] = {}
    for row in conn.execute("SELECT * FROM feeds ORDER BY folder, title"):
        parent = body
        if row["folder"]:
            if row["folder"] not in folders:
                folders[row["folder"]] = ET.SubElement(body, "outline", text=row["folder"], title=row["folder"])
            parent = folders[row["folder"]]
        attrs = {"type": "rss", "text": row["title"], "title": row["title"], "xmlUrl": row["url"]}
        if row["default_topic"]:
            attrs["category"] = row["default_topic"]
        if not row["enabled"]:
            attrs["enabled"] = "false"
        ET.SubElement(parent, "outline", attrs)
    ET.indent(root)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"
