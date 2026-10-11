#!/usr/bin/env python3
"""Security Log Watchtower — tails a log file and flags suspicious lines.

Local only, no network. Reads a log file (defaults to the bundled sample), scans each
line against severity rules, and emits alerts. Inspired in spirit by grobomo/github-agent
(https://github.com/grobomo/github-agent) — none of its code is used.

Emits NDJSON on stdout: {ts, bot, type: "bot.log|bot.alert|bot.metric", data}
Stdlib only (python3). Honors SIGINT/SIGTERM. Replays an existing file, then follows
appends (tail -f style) until stopped.
"""
import argparse, json, os, re, signal, sys, time
from datetime import datetime, timezone

BOT = "log-watchtower"
_running = True

RULES = [
    ("critical", re.compile(r"(root login|privilege escalation|malware|ransomware)", re.I)),
    ("high", re.compile(r"(failed password|authentication failure|invalid user|port scan|sql injection)", re.I)),
    ("medium", re.compile(r"(sudo|permission denied|unauthorized|403|401)", re.I)),
    ("low", re.compile(r"(warning|deprecated|retry)", re.I)),
]


def emit(kind, **data):
    sys.stdout.write(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "bot": BOT, "type": kind, "data": data}) + "\n")
    sys.stdout.flush()


def stop(*_):
    global _running
    _running = False


def classify(line: str):
    for severity, pat in RULES:
        if pat.search(line):
            return severity
    return None


def threat_level(counts):
    return next((severity for severity, _ in RULES if counts.get(severity, 0) > 0), "none")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=os.path.join(os.path.dirname(__file__), "..", "sample-data", "auth.sample.txt"))
    ap.add_argument("--interval", type=float, default=4.0)
    args = ap.parse_args()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    src = os.path.abspath(args.source)
    emit("bot.log", level="info", msg="watchtower online", source=src)
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    scanned = 0

    try:
        fh = open(src, "r", encoding="utf-8", errors="replace")
    except OSError as e:
        emit("bot.log", level="error", msg=f"cannot open source: {e}")
        return

    with fh:
        while _running:
            line = fh.readline()
            if not line:
                # reached EOF: emit a heartbeat metric, then wait for more
                emit("bot.metric", scanned=scanned, counts=dict(counts), threat_level=threat_level(counts))
                slept = 0.0
                while _running and slept < args.interval:
                    time.sleep(min(0.25, args.interval - slept))
                    slept += 0.25
                continue
            line = line.rstrip("\n")
            scanned += 1
            sev = classify(line)
            if sev:
                counts[sev] += 1
                emit("bot.alert", severity=sev, line=line[:500])
    emit("bot.log", level="info", msg="watchtower stopped", scanned=scanned, counts=counts)


if __name__ == "__main__":
    main()
