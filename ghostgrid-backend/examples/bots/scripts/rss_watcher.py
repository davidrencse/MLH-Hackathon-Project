#!/usr/bin/env python3
"""RSS Feed Watcher — polls an RSS/Atom feed and emits new items (watermark dedupe).

Uses the network to fetch the feed you pass in --feed. Read-only GET, no credentials.
Inspired in spirit by joobert/Mitten (https://github.com/joobert/Mitten) — none of its
code is used. Stdlib only (urllib + xml); no feedparser needed.

Emits NDJSON on stdout: {ts, bot, type: "bot.log|bot.item|bot.metric", data}
Honors SIGINT/SIGTERM.
"""
import argparse, json, signal, sys, time, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from collections import OrderedDict

BOT = "rss-watcher"
_running = True
_fetching = False


class StopRequested(Exception):
    pass


def emit(kind, **data):
    sys.stdout.write(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "bot": BOT, "type": kind, "data": data}) + "\n")
    sys.stdout.flush()


def stop(*_):
    global _running
    _running = False
    if _fetching:
        raise StopRequested()


def strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1]


def parse_items(xml_bytes: bytes):
    root = ET.fromstring(xml_bytes)
    items = []
    for el in root.iter():
        if strip_ns(el.tag) in ("item", "entry"):
            fields = {strip_ns(c.tag): (c.text or "").strip() for c in el}
            # Atom links store the URL in href rather than element text.
            for child in el:
                if strip_ns(child.tag) == "link" and child.get("href") and child.get("rel", "alternate") == "alternate":
                    fields["link"] = child.get("href")
                    break
            guid = fields.get("guid") or fields.get("id") or fields.get("link") or fields.get("title", "")
            items.append({"id": guid, "title": fields.get("title", "")[:300], "link": fields.get("link", "")})
    return items


def main():
    global _fetching
    ap = argparse.ArgumentParser()
    ap.add_argument("--feed", default="https://hnrss.org/frontpage")
    ap.add_argument("--interval", type=float, default=60.0)
    ap.add_argument("--max-polls", type=int, default=0)
    ap.add_argument("--history-limit", type=int, default=10_000)
    args = ap.parse_args()
    if args.history_limit < 1:
        ap.error("--history-limit must be a positive integer")
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    seen = OrderedDict()
    polls = 0
    emit("bot.log", level="info", msg="rss watcher online", feed=args.feed)

    while _running:
        try:
            req = urllib.request.Request(args.feed, headers={"User-Agent": "Ghostgrid-RSS-Bot/1.0"})
            _fetching = True
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = resp.read(4_000_001)
                    if len(data) > 4_000_000:
                        raise ValueError("feed exceeds the 4 MB response limit")
            finally:
                _fetching = False
            items = parse_items(data)
            fresh = 0
            for it in items:
                if not it["id"] or it["id"] in seen:
                    continue
                fresh += 1
                seen[it["id"]] = None
                if len(seen) > args.history_limit:
                    seen.popitem(last=False)
                # on the first poll just prime the watermark, don't flood
                if polls > 0:
                    emit("bot.item", **it)
            emit("bot.metric", total=len(items), new=0 if polls == 0 else fresh, tracked=len(seen))
        except StopRequested:
            break
        except Exception as e:  # noqa: BLE001 - network/parse errors are expected, keep running
            emit("bot.log", level="warn", msg=f"poll failed: {e}")

        polls += 1
        if args.max_polls and polls >= args.max_polls:
            break
        slept = 0.0
        while _running and slept < args.interval:
            time.sleep(min(0.5, args.interval - slept))
            slept += 0.5

    emit("bot.log", level="info", msg="rss watcher stopped", polls=polls, tracked=len(seen))


if __name__ == "__main__":
    main()
