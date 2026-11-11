#!/usr/bin/env python3
"""
Moikas "Jugando ahora" bot — runs on the NAS.

Watches your Discord server for what members are playing (their Discord status) and sends the list
to the site every 30 seconds, for the "Jugando ahora" bar. Only people who have logged into the site
are shown there; everyone else is ignored by the site.

It also "ticks" the site every 30 s so it can do its background chores: lock game-night votes, send the
1-hour reminder, give coins to people who show up, announce free games, and refresh Steam/Apex stats.

Needs: pip install discord.py   (the TrueNAS app below installs it for you)
Env:   DISCORD_BOT_TOKEN, SITE_URL (https://play.moikas.cc), SYNC_SECRET (same as the site's)
       optional JELLYFIN_URL (e.g. http://192.168.1.239:8096) + JELLYFIN_API_KEY → "what we're watching" + movie-night coins
       optional SEERR_URL + SEERR_API_KEY → "Pedir" on the site's watchlist sends requests to (Jelly)Seerr
       optional STATUS_CHECKS → the site's /status page, e.g. "Jellyfin=http://192.168.1.239:30013/health; Ocaso=tcp://192.168.1.239:25565"
       optional STATUS_DISK (a path mounted in the container, e.g. /tank) → disk usage on /status
Discord developer portal → your app → Bot → turn ON "Presence Intent" and "Server Members Intent".
"""
import asyncio
import json
import os
import shutil
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

import discord

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
SITE = os.environ.get("SITE_URL", "https://play.moikas.cc").rstrip("/")
SECRET = os.environ["SYNC_SECRET"]
EVERY = int(os.environ.get("EVERY_SECONDS", "30"))
IGNORE = {"Spotify", "Custom Status", "Visual Studio Code"}  # not games
JELLYFIN_URL = os.environ.get("JELLYFIN_URL", "").rstrip("/")
JELLYFIN_KEY = os.environ.get("JELLYFIN_API_KEY", "")
SEERR_URL = os.environ.get("SEERR_URL", "").rstrip("/")
SEERR_KEY = os.environ.get("SEERR_API_KEY", "")
STATUS_DISK = os.environ.get("STATUS_DISK", "")


def status_targets():
    """STATUS_CHECKS="Name=url; Name2=tcp://host:port" (Jellyfin/Seerr are added automatically if set)."""
    out = {}
    if JELLYFIN_URL:
        out["Jellyfin"] = JELLYFIN_URL + "/health"
    if SEERR_URL:
        out["Seerr"] = SEERR_URL + "/api/v1/status"
    for part in os.environ.get("STATUS_CHECKS", "").replace("\n", ";").split(";"):
        if "=" in part:
            name, url = part.split("=", 1)
            if name.strip() and url.strip():
                out[name.strip()[:40]] = url.strip()
    return out

intents = discord.Intents.none()
intents.guilds = True
intents.members = True
intents.presences = True
client = discord.Client(intents=intents)


def collect_music():
    out = {}
    for g in client.guilds:
        for m in g.members:
            if m.bot or m.id in out:
                continue
            for a in m.activities:
                if isinstance(a, discord.Spotify):
                    out[m.id] = {"discord_id": str(m.id), "title": a.title[:120], "artist": (a.artist or "")[:120],
                                 "cover": a.album_cover_url, "url": f"https://open.spotify.com/track/{a.track_id}"}
                    break
    return list(out.values())


def collect_jellyfin():
    """What people are watching on your Jellyfin server right now (local network call)."""
    if not (JELLYFIN_URL and JELLYFIN_KEY):
        return []
    try:
        req = urllib.request.Request(JELLYFIN_URL + "/Sessions?activeWithinSeconds=120",
                                     headers={"X-Emby-Token": JELLYFIN_KEY, "user-agent": "moikas-presence-bot"})
        with urllib.request.urlopen(req, timeout=10) as r:
            sessions = json.loads(r.read() or b"[]")
    except Exception as e:
        print("jellyfin:", e, flush=True)
        return []
    out = []
    for s in sessions:
        item = s.get("NowPlayingItem")
        if not item or not s.get("UserName"):
            continue
        out.append({"jellyfin_user": s["UserName"], "title": item.get("Name", "")[:120],
                    "series": (item.get("SeriesName") or "")[:120] or None})
    return out


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


def lan_get(url, headers=None, timeout=15):
    req = urllib.request.Request(url, headers={"user-agent": "moikas-presence-bot", "accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def jellyfin_library():
    """Every movie and show on Jellyfin (for the site's ✅ "En Jellyfin" badges and "Nuevo en Jellyfin")."""
    if not (JELLYFIN_URL and JELLYFIN_KEY):
        return None
    h = {"X-Emby-Token": JELLYFIN_KEY}
    q = "Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,DateCreated&EnableImages=false&Limit=5000"
    try:
        items = lan_get(f"{JELLYFIN_URL}/Items?{q}", h).get("Items")
        if items is None:
            raise ValueError("no Items")
    except Exception:
        try:  # older Jellyfin: needs a user id
            admin = next(u for u in lan_get(f"{JELLYFIN_URL}/Users", h) if u.get("Policy", {}).get("IsAdministrator"))
            items = lan_get(f"{JELLYFIN_URL}/Users/{admin['Id']}/Items?{q}", h).get("Items") or []
        except Exception as e:
            print("jellyfin library:", e, flush=True)
            return None
    return [{"id": i["Id"], "type": i.get("Type"), "name": i.get("Name", "")[:200], "year": i.get("ProductionYear"),
             "tmdb": (i.get("ProviderIds") or {}).get("Tmdb"), "added": i.get("DateCreated")} for i in items if i.get("Type") in ("Movie", "Series")]


def seerr(method, path, data=None):
    req = urllib.request.Request(SEERR_URL + path, data=json.dumps(data).encode() if data is not None else None, method=method,
                                 headers={"X-Api-Key": SEERR_KEY, "content-type": "application/json", "accept": "application/json",
                                          "user-agent": "moikas-presence-bot"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b"{}")


def seerr_request(q):
    """Send one watchlist request to Seerr. → {id, status: requested|exists|failed, detail, tmdb}"""
    kind = "movie" if q.get("kind") == "movie" else "tv"
    try:
        tmdb = q.get("tmdb")
        if tmdb:
            info = seerr("GET", f"/api/v1/{kind}/{tmdb}").get("mediaInfo") or {}
        else:
            res = seerr("GET", "/api/v1/search?page=1&language=es&query=" + urllib.parse.quote(q["title"], safe=""))
            cands = [r for r in res.get("results", []) if r.get("mediaType") == kind]
            def year_of(r):
                d = (r.get("releaseDate") or r.get("firstAirDate") or "")[:4]
                return int(d) if d.isdigit() else None
            y = q.get("year")
            pick = next((r for r in cands if y and year_of(r) and abs(year_of(r) - y) <= 1), None) or (cands[0] if cands else None)
            if not pick:
                return {"id": q["id"], "status": "failed", "detail": "Seerr no la encontró con ese nombre"}
            tmdb, info = pick["id"], pick.get("mediaInfo") or {}
        st = info.get("status")  # 2 pending, 3 processing, 4 partly available, 5 available
        if st in (2, 3, 4, 5):
            return {"id": q["id"], "status": "exists" if st == 5 else "requested", "tmdb": tmdb}
        body = {"mediaType": kind, "mediaId": int(tmdb)}
        if kind == "tv":
            body["seasons"] = "all"
        seerr("POST", "/api/v1/request", body)
        return {"id": q["id"], "status": "requested", "tmdb": tmdb}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")[:160]
        print("seerr:", e.code, detail, flush=True)
        return {"id": q["id"], "status": "failed", "detail": f"Seerr {e.code}"}
    except Exception as e:
        print("seerr:", e, flush=True)
        return None  # network hiccup → try again next time


def check(url):
    t0 = time.monotonic()
    try:
        if url.startswith("tcp://"):
            host, port = url[6:].rsplit(":", 1)
            with socket.create_connection((host, int(port)), timeout=6):
                pass
            return {"ok": True, "ms": round((time.monotonic() - t0) * 1000)}
        req = urllib.request.Request(url, headers={"user-agent": "moikas-status"})
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                code = r.status
        except urllib.error.HTTPError as e:
            code = e.code
        return {"ok": code < 500, "ms": round((time.monotonic() - t0) * 1000), "detail": None if code < 500 else f"HTTP {code}"}
    except Exception as e:
        return {"ok": False, "detail": str(e)[:120]}


def host_stats():
    out = {"cpus": os.cpu_count()}
    try:
        out["load"] = round(os.getloadavg()[0], 2)
    except OSError:
        pass
    try:
        mem = {k: int(v.split()[0]) for k, v in (l.split(":", 1) for l in open("/proc/meminfo")) if k in ("MemTotal", "MemAvailable")}
        out["mem_pct"] = round(100 - mem["MemAvailable"] / mem["MemTotal"] * 100)
    except Exception:
        pass
    if STATUS_DISK:
        try:
            du = shutil.disk_usage(STATUS_DISK)
            out["disk_pct"] = round(du.used / du.total * 100)
        except Exception:
            pass
    return out


def status_report():
    targets = status_targets()
    checks = [{"name": n, **check(u)} for n, u in targets.items()]
    return {"checks": checks, "host": host_stats()}


def post(path, payload):
    req = urllib.request.Request(SITE + path, data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", "authorization": f"Bearer {SECRET}",
                                          "user-agent": "moikas-presence-bot"}, method="POST")
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read() or b"{}")


async def media_and_status(n, pending):
    """Every 30 s: Seerr requests. Every 10 min: Jellyfin library. Every minute: service checks."""
    if (JELLYFIN_URL and JELLYFIN_KEY) or (SEERR_URL and SEERR_KEY):
        payload = {"seerr": bool(SEERR_URL and SEERR_KEY), "results": pending[:]}
        if n % 20 == 1:
            lib = await asyncio.to_thread(jellyfin_library)
            if lib is not None:
                payload["library"] = lib
        try:
            res = await asyncio.to_thread(post, "/api/sync/media", payload)
            pending.clear()
            if res.get("arrived") or res.get("fresh"):
                print(f"jellyfin: {res.get('fresh')} new, {res.get('arrived')} requests arrived", flush=True)
            if SEERR_URL and SEERR_KEY:
                for q in res.get("queue", []):
                    r = await asyncio.to_thread(seerr_request, q)
                    if r:
                        pending.append(r)
                        print(f"seerr: {q['title']} → {r['status']}", flush=True)
        except Exception as e:
            print("media sync failed:", e, flush=True)
    if n % 2 == 1 and status_targets():
        try:
            rep = await asyncio.to_thread(status_report)
            res = await asyncio.to_thread(post, "/api/sync/status", rep)
            if res.get("down") or res.get("up"):
                print("status:", res, flush=True)
        except Exception as e:
            print("status failed:", e, flush=True)


async def loop():
    await client.wait_until_ready()
    last = None
    n = 0
    pending = []
    while not client.is_closed():
        playing = collect()
        music = collect_music()
        watching = await asyncio.to_thread(collect_jellyfin)
        snapshot = {"playing": playing, "listening": music, "watching": watching}
        n += 1
        # send when something changed, and at least every ~2 min so the site knows the bot is alive
        if snapshot != last or n % 4 == 0:
            try:
                res = await asyncio.to_thread(post, "/api/sync/presence", snapshot)
                if last is None or playing != last["playing"]:
                    print(f"{len(playing)} playing → site shows {res.get('shown')}: " +
                          ", ".join(f"{p['game']}" for p in playing), flush=True)
                if last is None or watching != last["watching"]:
                    print(f"jellyfin: {len(watching)} watching → site shows {res.get('watching')}", flush=True)
                last = snapshot
            except Exception as e:
                print("push failed:", e, flush=True)
        try:
            t = await asyncio.to_thread(post, "/api/sync/tick", {})
            news = {k: v for k, v in t.items() if k != "ok" and v not in (None, 0, "ok")}
            if news:
                print("tick:", news, flush=True)
        except Exception as e:
            print("tick failed:", e, flush=True)
        await media_and_status(n, pending)
        await asyncio.sleep(EVERY)


@client.event
async def on_ready():
    print(f"Logged in as {client.user} — watching {len(client.guilds)} server(s)", flush=True)


async def main():
    async with client:
        client.loop.create_task(loop())
        await client.start(TOKEN)

asyncio.run(main())
