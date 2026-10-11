#!/usr/bin/env python3
"""Paper Trading Bot — simulated SMA-crossover strategy.

PAPER ONLY. No exchange, no keys, no real orders. Price is a synthetic random walk,
so nothing here touches the network or real money. Inspired in spirit by Freqtrade
(https://github.com/freqtrade/freqtrade) — none of its code is used.

Emits NDJSON events on stdout, one JSON object per line:
  {"ts": iso8601, "bot": "paper-trader", "type": "bot.log|bot.signal|bot.metric", "data": {...}}

The GhostGrid Bot Runner captures stdout lines as events/metrics. Exits cleanly on
SIGINT/SIGTERM. Stdlib only (python3).
"""
import argparse, json, random, signal, sys, time
from datetime import datetime, timezone

BOT = "paper-trader"
_running = True


def emit(kind: str, **data):
    line = {"ts": datetime.now(timezone.utc).isoformat(), "bot": BOT, "type": kind, "data": data}
    sys.stdout.write(json.dumps(line) + "\n")
    sys.stdout.flush()


def stop(*_):
    global _running
    _running = False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="BTC-USD")
    ap.add_argument("--cash", type=float, default=10_000.0)
    ap.add_argument("--fast", type=int, default=5)
    ap.add_argument("--slow", type=int, default=20)
    ap.add_argument("--interval", type=float, default=5.0, help="seconds between ticks")
    ap.add_argument("--max-ticks", type=int, default=0, help="0 = run until stopped")
    args = ap.parse_args()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    price = 50_000.0
    cash = args.cash
    units = 0.0
    history: list[float] = []
    position = "flat"
    ticks = 0

    emit("bot.log", level="info", msg=f"paper trader online for {args.symbol} (paper mode)",
         strategy=f"SMA {args.fast}/{args.slow}", starting_cash=cash)

    while _running:
        # synthetic random-walk price (no network)
        price = max(1.0, price * (1 + random.gauss(0, 0.004)))
        history.append(price)
        if len(history) > args.slow:
            history.pop(0)

        if len(history) >= args.slow:
            fast = sum(history[-args.fast:]) / args.fast
            slow = sum(history) / len(history)
            if fast > slow and position == "flat":
                units = cash / price
                cash = 0.0
                position = "long"
                emit("bot.signal", action="buy", symbol=args.symbol, price=round(price, 2),
                     units=round(units, 6), reason="fast SMA crossed above slow")
            elif fast < slow and position == "long":
                cash = units * price
                units = 0.0
                position = "flat"
                emit("bot.signal", action="sell", symbol=args.symbol, price=round(price, 2),
                     cash=round(cash, 2), reason="fast SMA crossed below slow")

        equity = cash + units * price
        pnl = equity - args.cash
        emit("bot.metric", symbol=args.symbol, price=round(price, 2), equity=round(equity, 2),
             pnl=round(pnl, 2), pnl_pct=round(100 * pnl / args.cash, 3), position=position)

        ticks += 1
        if args.max_ticks and ticks >= args.max_ticks:
            break
        # responsive sleep so SIGTERM is honored promptly
        slept = 0.0
        while _running and slept < args.interval:
            time.sleep(min(0.25, args.interval - slept))
            slept += 0.25

    emit("bot.log", level="info", msg="paper trader stopped", final_pnl=round(cash + units * price - args.cash, 2))


if __name__ == "__main__":
    main()
