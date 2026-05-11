"""
api/ws.py
---------
WebSocket endpoint for real-time price streaming (Phase 7).

Architecture:
  One persistent Twelve Data WebSocket connection (fan-out manager)
  → N frontend clients subscribed to specific symbols.

Endpoint: ws://host/ws/quotes

Client → Server messages:
  {"action": "subscribe",   "symbols": ["AAPL", "BTC-USD", "^GSPC"]}
  {"action": "unsubscribe", "symbols": ["AAPL"]}
  {"action": "ping"}

Server → Client messages:
  {"type": "status",   "connected": true}
  {"type": "snapshot", "prices": {tdSymbol: {symbol, price, timestamp}}}
  {"type": "price",    "symbol": "AAPL", "price": 150.25, "timestamp": "..."}
  {"type": "pong"}
  {"type": "error",    "message": "..."}

Symbol mapping: yfinance-style tickers (e.g. "^GSPC", "BTC-USD") are
automatically converted to Twelve Data format (e.g. "SPX", "BTC/USD").
"""

import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Dict, Set, Optional

import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.instruments.twelvedata_provider import map_symbol

logger   = logging.getLogger(__name__)
router   = APIRouter(tags=["websocket"])

TD_WS_URL = "wss://ws.twelvedata.com/v1/quotes/price"


# ─────────────────────────────────────────────────────────────────────────────
# PriceFanout — single TD connection → many frontend clients
# ─────────────────────────────────────────────────────────────────────────────

class PriceFanout:
    """
    Manages one persistent Twelve Data WebSocket and fans price events
    out to all connected frontend clients.

    Thread-safety: all methods run in the same asyncio event loop.
    """

    def __init__(self, api_key: str):
        self.api_key       = api_key
        self._td_ws        = None
        self._clients:     Dict[WebSocket, Set[str]] = {}  # ws → subscribed TD symbols
        self._price_cache: Dict[str, dict]           = {}  # tdSymbol → last price event
        self._subscribed:  Set[str]                  = set()
        self._lock         = asyncio.Lock()
        self._conn_task: Optional[asyncio.Task]      = None

    # ── Client lifecycle ──────────────────────────────────────────────────────

    async def connect_client(self, ws: WebSocket):
        """Accept a new frontend WebSocket and send the current price snapshot."""
        await ws.accept()
        async with self._lock:
            self._clients[ws] = set()
        await ws.send_json({"type": "status", "connected": True})
        if self._price_cache:
            await ws.send_json({"type": "snapshot", "prices": self._price_cache})

    async def disconnect_client(self, ws: WebSocket):
        async with self._lock:
            self._clients.pop(ws, None)

    async def subscribe_client(self, ws: WebSocket, tickers: list[str]):
        """
        Subscribe this client to a list of tickers (yfinance or TD format).
        Newly-required symbols are forwarded to the Twelve Data WS.
        """
        td_symbols = {map_symbol(t) for t in tickers}

        async with self._lock:
            if ws in self._clients:
                self._clients[ws].update(td_symbols)
            new_subs = td_symbols - self._subscribed
            if new_subs:
                self._subscribed.update(new_subs)

        # Tell TD about the new symbols
        if new_subs and self._td_ws:
            try:
                await self._td_ws.send(json.dumps({
                    "action": "subscribe",
                    "params": {"symbols": ",".join(new_subs)},
                }))
                logger.debug(f"[WS] subscribed to TD: {new_subs}")
            except Exception as e:
                logger.warning(f"[WS] subscribe failed: {e}")

        # Immediately push cached prices for already-known symbols
        cached = {s: self._price_cache[s] for s in td_symbols if s in self._price_cache}
        if cached:
            try:
                await ws.send_json({"type": "snapshot", "prices": cached})
            except Exception:
                pass

    # ── TD WebSocket lifecycle ────────────────────────────────────────────────

    async def start(self):
        """Ensure the TD connection loop is running."""
        if not self.api_key:
            logger.warning("[WS] TWELVE_DATA_API_KEY not set — WebSocket disabled")
            return
        if self._conn_task is None or self._conn_task.done():
            self._conn_task = asyncio.create_task(self._connection_loop())

    async def _connection_loop(self):
        """Persistent reconnect loop for the Twelve Data WebSocket."""
        backoff = 1
        while True:
            try:
                logger.info("[WS] Connecting to Twelve Data WS…")
                async with websockets.connect(
                    f"{TD_WS_URL}?apikey={self.api_key}",
                    ping_interval=20,
                    ping_timeout=10,
                    close_timeout=5,
                ) as td_ws:
                    self._td_ws = td_ws
                    backoff     = 1
                    logger.info("[WS] ✓ Connected to Twelve Data")

                    # Re-subscribe after reconnect
                    if self._subscribed:
                        await td_ws.send(json.dumps({
                            "action": "subscribe",
                            "params": {"symbols": ",".join(self._subscribed)},
                        }))

                    async for raw in td_ws:
                        try:
                            msg = json.loads(raw)
                            await self._handle_td_message(msg)
                        except Exception as e:
                            logger.debug(f"[WS] msg parse error: {e}")

            except Exception as e:
                self._td_ws = None
                logger.warning(f"[WS] TD disconnected: {e} — retry in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    async def _handle_td_message(self, msg: dict):
        """Process a Twelve Data message and broadcast to subscribers."""
        event = msg.get("event")

        if event in ("heartbeat", "subscribe-status"):
            logger.debug(f"[WS] {event}: {msg}")
            return

        if event == "price":
            symbol = msg.get("symbol", "")
            price  = msg.get("price")
            if not symbol or price is None:
                return

            price_event = {
                "symbol":    symbol,
                "price":     float(price),
                "timestamp": datetime.now().isoformat(),
            }
            self._price_cache[symbol] = price_event

            out  = {"type": "price", **price_event}
            dead: list[WebSocket] = []

            for ws, subs in list(self._clients.items()):
                if symbol in subs:
                    try:
                        await ws.send_json(out)
                    except Exception:
                        dead.append(ws)

            if dead:
                async with self._lock:
                    for ws in dead:
                        self._clients.pop(ws, None)


# ─────────────────────────────────────────────────────────────────────────────
# Singleton
# ─────────────────────────────────────────────────────────────────────────────

_fanout: Optional[PriceFanout] = None


def get_fanout() -> PriceFanout:
    global _fanout
    if _fanout is None:
        api_key = os.getenv("TWELVE_DATA_API_KEY", "")
        _fanout = PriceFanout(api_key)
    return _fanout


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket):
    """
    Real-time price streaming via Twelve Data.

    Subscribe:   {"action": "subscribe",   "symbols": ["AAPL", "BTC-USD"]}
    Unsubscribe: {"action": "unsubscribe", "symbols": ["AAPL"]}
    Ping:        {"action": "ping"}
    """
    fanout = get_fanout()
    await fanout.start()
    await fanout.connect_client(websocket)

    try:
        while True:
            data    = await websocket.receive_json()
            action  = data.get("action", "")
            symbols = data.get("symbols", [])

            if action == "subscribe" and symbols:
                await fanout.subscribe_client(websocket, symbols)

            elif action == "unsubscribe" and symbols:
                td_symbols = {map_symbol(s) for s in symbols}
                async with fanout._lock:
                    if websocket in fanout._clients:
                        fanout._clients[websocket] -= td_symbols

            elif action == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"[WS] client error: {e}")
    finally:
        await fanout.disconnect_client(websocket)
