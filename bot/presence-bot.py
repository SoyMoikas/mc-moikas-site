#!/usr/bin/env python3
"""
Moikas "Jugando ahora" bot — runs on the NAS.

Watches your Discord server for what members are playing (their Discord status) and sends the list
to the site every 30 seconds, for the "Jugando ahora" bar. Only people who have logged into the site
are shown there; everyone else is ignored by the site.

Needs: pip install discord.py   (the TrueNAS app below installs it for you)
Env:   DISCORD_BOT_TOKEN, SITE_URL (https://play.moikas.cc), SYNC_SECRET (same as the site's)
Discord developer portal → your app → Bot → turn ON "Presence Intent" and "Server Members Intent".
"""
import asyncio
import json
import os
import urllib.request

import discord

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
SITE = os.environ.get("SITE_URL", "https://play.moikas.cc").rstrip("/")
SECRET = os.environ["SYNC_SECRET"]
EVERY = int(os.environ.get("EVERY_SECONDS", "30"))
IGNORE = {"Spotify", "Custom Status", "Visual Studio Code"}  # not games

intents = discord.Intents.none()
intents.guilds = True
intents.members = True
intents.presences = True
client = discord.Client(intents=intents)


def collect():
    seen = {}
    for g in client.guilds:
        for m in g.members:
            if m.bot or m.id in seen:
                continue
            for a in m.activities:
                kind = {discord.ActivityType.playing: "playing", discord.ActivityType.streaming: "streaming",
                        discord.ActivityType.competing: "competing"}.get(a.type)
                name = getattr(a, "game", None) if a.type == discord.ActivityType.streaming else a.name
                if not kind or not name or name in IGNORE:
                    continue
                start = getattr(a, "start", None) or getattr(a, "created_at", None)
                seen[m.id] = {"discord_id": str(m.id), "game": str(name)[:80], "kind": kind,
                              "since": int(start.timestamp() * 1000) if start else None}
                break
    return list(seen.values())


def push(playing):
    req = urllib.request.Request(SITE + "/api/sync/presence", data=json.dumps({"playing": playing}).encode(),
                                 headers={"content-type": "application/json", "authorization": f"Bearer {SECRET}",
                                          "user-agent": "moikas-presence-bot"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b"{}")


async def loop():
    await client.wait_until_ready()
    last = None
    n = 0
    while not client.is_closed():
        playing = collect()
        n += 1
        # send when something changed, and at least every ~2 min so the site knows the bot is alive
        if playing != last or n % 4 == 0:
            try:
                res = await asyncio.to_thread(push, playing)
                if playing != last:
                    print(f"{len(playing)} playing → site shows {res.get('shown')}: " +
                          ", ".join(f"{p['game']}" for p in playing), flush=True)
                last = playing
            except Exception as e:
                print("push failed:", e, flush=True)
        await asyncio.sleep(EVERY)


@client.event
async def on_ready():
    print(f"Logged in as {client.user} — watching {len(client.guilds)} server(s)", flush=True)


async def main():
    async with client:
        client.loop.create_task(loop())
        await client.start(TOKEN)

asyncio.run(main())
