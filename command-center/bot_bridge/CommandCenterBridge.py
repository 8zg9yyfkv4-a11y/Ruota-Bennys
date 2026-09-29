from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import discord
from discord.ext import commands, tasks


COMMAND_CENTER_URL = os.getenv("COMMAND_CENTER_URL", "").rstrip("/")
COMMAND_CENTER_BRIDGE_KEY = os.getenv("COMMAND_CENTER_BRIDGE_KEY", "")
BASE_DIR = Path(__file__).resolve().parents[2]
DATABASE_PATH = Path(os.getenv("ARMERIA PALETO_DATABASE_PATH", BASE_DIR / "data" / "lsc_bot.sqlite3"))


def _post(path: str, payload: dict[str, Any]) -> None:
    if not COMMAND_CENTER_URL or not COMMAND_CENTER_BRIDGE_KEY:
        return
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{COMMAND_CENTER_URL}{path}",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-ARMERIA PALETO-Bridge-Key": COMMAND_CENTER_BRIDGE_KEY,
            "User-Agent": "ARMERIA PALETO-Bot-CommandCenterBridge/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except (urllib.error.URLError, TimeoutError):
        # Il bridge non deve mai bloccare o spegnere il bot ufficiale.
        return


async def post_bridge(path: str, payload: dict[str, Any]) -> None:
    await asyncio.to_thread(_post, path, payload)


class CommandCenterBridge(commands.Cog):
    """Bridge non invasivo tra il bot ufficiale e ARMERIA PALETO Command Center."""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.heartbeat.start()

    def cog_unload(self) -> None:
        self.heartbeat.cancel()

    async def emit_event(
        self,
        *,
        event: str,
        module: str,
        actor: discord.abc.User | None = None,
        actor_name: str | None = None,
        actor_role: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        await post_bridge(
            "/api/bridge/event",
            {
                "event": event,
                "module": module,
                "actor_id": str(actor.id) if actor else None,
                "actor_name": actor_name or (getattr(actor, "display_name", None) if actor else None) or "ARMERIA PALETO Bot",
                "actor_role": actor_role,
                "detail": detail or {},
            },
        )

    def _db_diagnostics(self) -> dict[str, Any]:
        if not DATABASE_PATH.is_file():
            return {"available": False, "path": str(DATABASE_PATH)}
        try:
            with sqlite3.connect(f"file:{DATABASE_PATH}?mode=ro", uri=True, timeout=3) as conn:
                rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
                table_names = [row[0] for row in rows if not row[0].startswith("sqlite_")]
                counts: dict[str, int] = {}
                for table in table_names[:60]:
                    safe = table.replace('"', '""')
                    try:
                        counts[table] = int(conn.execute(f'SELECT COUNT(*) FROM "{safe}"').fetchone()[0])
                    except sqlite3.DatabaseError:
                        continue
            return {
                "available": True,
                "tables": len(table_names),
                "table_names": table_names,
                "row_counts": counts,
            }
        except sqlite3.DatabaseError as exc:
            return {"available": False, "error": str(exc)}

    @tasks.loop(seconds=60)
    async def heartbeat(self) -> None:
        guilds = list(self.bot.guilds)
        primary = guilds[0] if guilds else None
        payload = {
            "bot": {
                "online": self.bot.is_ready(),
                "latency_ms": round(self.bot.latency * 1000, 1),
                "loaded_cogs": len(self.bot.cogs),
            },
            "guild": {
                "id": str(primary.id) if primary else None,
                "name": primary.name if primary else None,
                "member_count": primary.member_count if primary else 0,
            },
            "database": await asyncio.to_thread(self._db_diagnostics),
        }
        await post_bridge("/api/bridge/snapshot", {"key": "bridge_health", "payload": payload})

    @heartbeat.before_loop
    async def before_heartbeat(self) -> None:
        await self.bot.wait_until_ready()


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(CommandCenterBridge(bot))
