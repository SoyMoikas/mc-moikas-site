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
       optional STATUS_DISK (a path mounted in the container, e.g. /tank) → disk usage on /status and the Espacio tab
       optional RADARR_URL + RADARR_API_KEY → "Limpieza" deletes movies through Radarr (files + import exclusion)
Discord developer portal → your app → Bot → turn ON "Presence Intent" and "Server Members Intent".
"""
import asyncio
import json
import os
import shutil
import socket
import ssl
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
JELLYFIN_KEY = os.environ.get("JELLYFIN_API_KEY", "").strip()
# Newer Jellyfin only accepts the key in the Authorization header (the old X-Emby-Token is off by default) → send both.
JF_HEADERS = {"Authorization": f'MediaBrowser Client="moikas-bot", Device="NAS", DeviceId="moikas-bot", Version="1.0", Token="{JELLYFIN_KEY}"',
              "X-Emby-Token": JELLYFIN_KEY}
SEERR_URL = os.environ.get("SEERR_URL", "").rstrip("/")
SEERR_KEY = os.environ.get("SEERR_API_KEY", "").strip()
STATUS_DISK = os.environ.get("STATUS_DISK", "")
RADARR_URL = os.environ.get("RADARR_URL", "").rstrip("/")
RADARR_KEY = os.environ.get("RADARR_API_KEY", "").strip()


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
                                     headers={**JF_HEADERS, "user-agent": "moikas-presence-bot"})
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
    h = JF_HEADERS
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


def jf_items(query, user_id=None):
    """/Items for the whole library (or as one user, to get their watch data)."""
    base = f"{JELLYFIN_URL}/Items?{query}" + (f"&userId={user_id}" if user_id else "")
    try:
        return lan_get(base, JF_HEADERS, timeout=60).get("Items") or []
    except urllib.error.HTTPError:
        if not user_id:
            raise
        return lan_get(f"{JELLYFIN_URL}/Users/{user_id}/Items?{query}", JF_HEADERS, timeout=60).get("Items") or []


def jellyfin_usage():
    """Size of every movie / show (episodes summed per show) + the last time ANY user played it."""
    if not (JELLYFIN_URL and JELLYFIN_KEY):
        return None
    try:
        users = lan_get(f"{JELLYFIN_URL}/Users", JF_HEADERS)
        q = "Recursive=true&IncludeItemTypes=Movie,Episode&Fields=MediaSources&EnableImages=false&EnableUserData=false&Limit=50000"
        try:
            items = jf_items(q)
        except urllib.error.HTTPError:
            items = jf_items(q, next(u["Id"] for u in users if u.get("Policy", {}).get("IsAdministrator")))
        size, kind, last, plays = {}, {}, {}, {}
        key = lambda i: i["Id"] if i.get("Type") == "Movie" else i.get("SeriesId")
        for i in items:
            k = key(i)
            if not k:
                continue
            kind[k] = "Movie" if i.get("Type") == "Movie" else "Series"
            size[k] = size.get(k, 0) + sum((m.get("Size") or 0) for m in (i.get("MediaSources") or []))
        uq = "Recursive=true&IncludeItemTypes=Movie,Episode&EnableImages=false&EnableUserData=true&Fields=SeriesId&Limit=50000"
        for u in users:
            for i in jf_items(uq, u["Id"]):
                k, ud = key(i), i.get("UserData") or {}
                if not k:
                    continue
                if ud.get("LastPlayedDate") and ud["LastPlayedDate"] > last.get(k, ""):
                    last[k] = ud["LastPlayedDate"]
                plays[k] = plays.get(k, 0) + (ud.get("PlayCount") or 0)
        return [{"id": k, "type": kind[k], "size": size.get(k, 0), "last_played": last.get(k), "plays": plays.get(k, 0)} for k in kind]
    except Exception as e:
        print("jellyfin usage:", e, flush=True)
        return None


def pool_usage():
    """Used/free of the pool mounted at STATUS_DISK: adds up every dataset mounted under it (ZFS shows each one separately)."""
    if not STATUS_DISK:
        return None
    try:
        base = os.path.realpath(STATUS_DISK)
        mounts = [l.split()[1].replace("\\040", " ") for l in open("/proc/mounts")]
        used, free, seen = 0, None, set()
        for m in [m for m in mounts if m == base or m.startswith(base + "/")] or [base]:
            try:
                dev, st = os.stat(m).st_dev, os.statvfs(m)
            except OSError:
                continue
            if dev in seen:
                continue
            seen.add(dev)
            used += (st.f_blocks - st.f_bfree) * st.f_frsize
            avail = st.f_bavail * st.f_frsize
            free = avail if free is None else min(free, avail)
        return {"total": used + (free or 0), "used": used, "free": free or 0}
    except Exception as e:
        print("pool usage:", e, flush=True)
        return None


def arr(method, path):
    req = urllib.request.Request(RADARR_URL + path, method=method, headers={"X-Api-Key": RADARR_KEY, "accept": "application/json", "user-agent": "moikas-presence-bot"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
        return json.loads(body) if body else None


def delete_movie(d):
    """Limpieza: delete one movie. Radarr first (files + import exclusion so it isn't downloaded again), else straight from Jellyfin."""
    try:
        if RADARR_URL and RADARR_KEY and d.get("tmdb"):
            found = arr("GET", f"/api/v3/movie?tmdbId={int(d['tmdb'])}") or []
            if found:
                arr("DELETE", f"/api/v3/movie/{found[0]['id']}?deleteFiles=true&addImportExclusion=true")
                via = "radarr"
            else:
                via = None
        else:
            via = None
        if not via:
            req = urllib.request.Request(f"{JELLYFIN_URL}/Items/{d['jf_id']}", method="DELETE", headers={**JF_HEADERS, "user-agent": "moikas-presence-bot"})
            urllib.request.urlopen(req, timeout=60).read()
            via = "jellyfin"
        try:
            urllib.request.urlopen(urllib.request.Request(f"{JELLYFIN_URL}/Library/Refresh", method="POST", data=b"", headers=JF_HEADERS), timeout=20).read()
        except Exception:
            pass
        return {"jf_id": d["jf_id"], "ok": True, "via": via}
    except urllib.error.HTTPError as e:
        return {"jf_id": d["jf_id"], "ok": False, "detail": f"{e.code} {e.read().decode(errors='ignore')[:120]}"}
    except Exception as e:
        return {"jf_id": d["jf_id"], "ok": False, "detail": str(e)[:150]}


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
        try:  # self-signed certificates (TrueNAS, routers…) still count as "it answered"
            with urllib.request.urlopen(req, timeout=8, context=ssl._create_unverified_context()) as r:
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
        avail = mem["MemAvailable"]
        try:  # ZFS keeps free RAM as disk cache (ARC) and gives it back when apps need it → count it as available
            arc = next(int(l.split()[2]) for l in open("/proc/spl/kstat/zfs/arcstats") if l.startswith("size "))
            avail = min(mem["MemTotal"], avail + arc // 1024)
        except Exception:
            pass
        out["mem_pct"] = round(100 - avail / mem["MemTotal"] * 100)
    except Exception:
        pass
    pool = pool_usage()
    if pool and pool["total"]:
        out["disk_pct"] = round(pool["used"] / pool["total"] * 100)
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


async def media_and_status(n, pending, deleted):
    """Every 30 s: Seerr requests + deletions. Every 10 min: Jellyfin library. Every hour: sizes, watch data, pool usage."""
    if (JELLYFIN_URL and JELLYFIN_KEY) or (SEERR_URL and SEERR_KEY):
        payload = {"seerr": bool(SEERR_URL and SEERR_KEY), "results": pending[:], "deleted": deleted[:]}
        if n % 20 == 1:
            lib = await asyncio.to_thread(jellyfin_library)
            if lib is not None:
                payload["library"] = lib
        if n % 120 == 1:
            usage = await asyncio.to_thread(jellyfin_usage)
            if usage is not None:
                payload["usage"] = usage
            pool = await asyncio.to_thread(pool_usage)
            if pool:
                payload["storage"] = pool
        try:
            res = await asyncio.to_thread(post, "/api/sync/media", payload)
            pending.clear()
            deleted.clear()
            if res.get("cleanup", {}) and res["cleanup"].get("flagged"):
                print(f"limpieza: {res['cleanup']['flagged']} movies flagged", flush=True)
            for d in res.get("delete", [])[:3]:
                r = await asyncio.to_thread(delete_movie, d)
                deleted.append(r)
                print(f"limpieza: {d.get('title')} → {'deleted via ' + r.get('via', '') if r['ok'] else 'FAILED ' + r.get('detail', '')}", flush=True)
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
    pending, deleted = [], []
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
        await media_and_status(n, pending, deleted)
        await asyncio.sleep(EVERY)


@client.event
async def on_ready():
    print(f"Logged in as {client.user} — watching {len(client.guilds)} server(s)", flush=True)


async def main():
    async with client:
        client.loop.create_task(loop())
        await client.start(TOKEN)

asyncio.run(main())
