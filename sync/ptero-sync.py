#!/usr/bin/env python3
"""
Pushes Pterodactyl server info to the website (mc.moikas.cc/api/sync).

Runs on the NAS (TrueNAS cron job). Talks to the Pterodactyl panel over your LAN,
pings each Minecraft server for its player count, then sends a small JSON summary
to the site. Your panel and API key never leave the house. Python 3 stdlib only.

Config: sync.env next to this script (see sync.env.example).
Every run (cron, every 2 min): server status + sends pending website link codes in-game (/tell)
+ runs whitelist/ban actions staff queued on the site and sends back each server's whitelist & ban list.
Every 10 min: player playtime, stats and advancements for levels and quests.
Every run: Ocaso data (sanity, gods' favor, orders, Mictlán, Blood Moon, deaths) from Skript's variables.csv and the log.
Every 6 h: a catalog of every stat/advancement players have (so the site can suggest trackable quests).

Usage:  python3 ptero-sync.py          # run once (cron calls this)
        python3 ptero-sync.py --dry    # print what would be sent, don't send
        python3 ptero-sync.py --stats  # force the player stats sync now
        python3 ptero-sync.py --scan   # force the stats + quest-ideas catalog scan now
"""
import json
import re
import os
import time
import urllib.parse
import socket
import struct
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

# Only these egg variables are sent. Never add secrets (RCON passwords, API keys, etc.).
DEFAULT_VARIABLES = [
    "MINECRAFT_VERSION", "MC_VERSION", "VANILLA_VERSION", "VERSION",
    "FORGE_VERSION", "NEOFORGE_VERSION", "FABRIC_VERSION", "FABRIC_LOADER_VERSION",
    "LOADER_VERSION", "QUILT_VERSION", "BUILD_NUMBER",
    "MODPACK_VERSION", "PROJECT_ID", "VERSION_ID",
]


def load_config():
    cfg = {}
    path = os.path.join(HERE, "sync.env")
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    cfg[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("PTERO_URL", "PTERO_KEY", "SITE_URL", "SYNC_SECRET", "PING_HOST", "VARIABLES", "STATS_EVERY_MIN"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    missing = [k for k in ("PTERO_URL", "PTERO_KEY", "SITE_URL", "SYNC_SECRET") if not cfg.get(k)]
    if missing:
        sys.exit(f"Missing config: {', '.join(missing)} (set them in {path})")
    cfg.setdefault("PING_HOST", "127.0.0.1")
    cfg["STATS_EVERY_MIN"] = int(cfg.get("STATS_EVERY_MIN") or 10)
    cfg["VARIABLES"] = [v.strip() for v in cfg["VARIABLES"].split(",")] if cfg.get("VARIABLES") else DEFAULT_VARIABLES
    return cfg


def http_json(url, headers=None, data=None, timeout=15):
    body = json.dumps(data).encode() if data is not None else None
    h = {"User-Agent": "moikas-ptero-sync/1.0", **(headers or {})}
    if body is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=h, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _ptero_headers(cfg):
    return {"Authorization": f"Bearer {cfg['PTERO_KEY']}", "Accept": "Application/vnd.pterodactyl.v1+json",
            "User-Agent": "moikas-ptero-sync/1.0"}


def ptero(cfg, path):
    return http_json(cfg["PTERO_URL"].rstrip("/") + path, _ptero_headers(cfg))


def ptero_text(cfg, ident, file_path):
    """Read a file from a server through Pterodactyl's file API. Returns None if it doesn't exist."""
    q = urllib.parse.quote(file_path, safe="")
    req = urllib.request.Request(f"{cfg['PTERO_URL'].rstrip('/')}/api/client/servers/{ident}/files/contents?file={q}",
                                 headers=_ptero_headers(cfg))
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (404, 400, 500):
            return None
        raise


def ptero_list(cfg, ident, directory):
    q = urllib.parse.quote(directory, safe="")
    try:
        data = ptero(cfg, f"/api/client/servers/{ident}/files/list?directory={q}")
    except urllib.error.HTTPError as e:
        if e.code in (404, 400, 500):
            return []
        raise
    return [x["attributes"]["name"] for x in data.get("data", []) if x["attributes"].get("is_file")]


def ptero_command(cfg, ident, command):
    req = urllib.request.Request(f"{cfg['PTERO_URL'].rstrip('/')}/api/client/servers/{ident}/command",
                                 data=json.dumps({"command": command}).encode(),
                                 headers={**_ptero_headers(cfg), "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10):
        pass


def list_servers(cfg):
    page, include = 1, "&include=egg"
    while True:
        try:
            data = ptero(cfg, f"/api/client?per_page=50&page={page}{include}")
        except urllib.error.HTTPError as e:
            if include and e.code in (400, 403):  # egg include not allowed → retry without it
                include = ""
                continue
            raise
        for item in data.get("data", []):
            yield item["attributes"]
        pag = data.get("meta", {}).get("pagination", {})
        if page >= pag.get("total_pages", 1):
            return
        page += 1


# --- Minecraft Server List Ping (for player counts) ---

def _varint(n):
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        out += bytes([b | (0x80 if n else 0)])
        if not n:
            return out


def _read_varint(sock):
    n = 0
    for i in range(5):
        b = sock.recv(1)
        if not b:
            raise IOError("connection closed")
        n |= (b[0] & 0x7F) << (7 * i)
        if not b[0] & 0x80:
            return n
    raise IOError("varint too long")


def mc_ping(host, port, timeout=3):
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.settimeout(timeout)
        h = host.encode()
        hs = _varint(0) + _varint(47) + _varint(len(h)) + h + struct.pack(">H", port) + _varint(1)
        s.sendall(_varint(len(hs)) + hs + b"\x01\x00")
        _read_varint(s)               # packet length
        _read_varint(s)               # packet id
        n = _read_varint(s)           # json length
        buf = b""
        while len(buf) < n:
            chunk = s.recv(min(65536, n - len(buf)))
            if not chunk:
                break
            buf += chunk
        players = json.loads(buf.decode("utf-8", "replace")).get("players", {})
        return players.get("online"), players.get("max")


def collect(cfg):
    out = []
    for a in list_servers(cfg):
        ident = a["identifier"]
        allocs = [x["attributes"] for x in a.get("relationships", {}).get("allocations", {}).get("data", [])]
        alloc = next((x for x in allocs if x.get("is_default")), allocs[0] if allocs else {})
        variables = {}
        for v in a.get("relationships", {}).get("variables", {}).get("data", []):
            v = v["attributes"]
            if v.get("env_variable") in cfg["VARIABLES"]:
                val = v.get("server_value") or v.get("default_value")
                if val not in (None, ""):
                    variables[v["env_variable"]] = str(val)
        egg = (a.get("relationships", {}).get("egg", {}) or {}).get("attributes", {}).get("name")

        state = "unknown"
        try:
            state = ptero(cfg, f"/api/client/servers/{ident}/resources")["attributes"]["current_state"]
        except Exception as e:  # suspended/installing servers can 409
            print(f"  {a['name']}: couldn't read state ({e})", file=sys.stderr)

        online = mx = None
        port = alloc.get("port")
        if state == "running" and port:
            host = alloc.get("ip") if alloc.get("ip") not in (None, "", "0.0.0.0") else cfg["PING_HOST"]
            try:
                online, mx = mc_ping(host, int(port))
            except Exception:
                pass  # not a Minecraft server, or still starting

        out.append({
            "uuid": a["uuid"], "identifier": ident, "name": a.get("name"),
            "description": a.get("description") or None, "egg": egg,
            "ip": alloc.get("ip_alias") or alloc.get("ip"), "port": port,
            "state": state, "players_online": online, "players_max": mx,
            "variables": variables,
        })
        print(f"  {a['name']}: {state}, port {port}, players {online}/{mx}, vars {variables}")
    return out


def send_link_codes(cfg, servers, codes, dry):
    """DM each pending website link code to that player on every running server."""
    running = [x for x in servers if x["state"] == "running"]
    for v in codes:
        name = str(v.get("name", ""))
        code = str(v.get("code", ""))
        if not (3 <= len(name) <= 16 and name.replace("_", "").isalnum() and code.isdigit()):
            continue  # never put anything odd into a console command
        for x in running:
            cmd = f"tell {name} Moikas MC - codigo/code: {code}"
            if dry:
                print(f"  would run on {x['name']}: {cmd}")
                continue
            try:
                ptero_command(cfg, x["identifier"], cmd)
            except Exception as e:
                print(f"  {x['name']}: couldn't send code ({e})", file=sys.stderr)


# ---------- whitelist & bans queued on the website ----------
JAVA_NAME = re.compile(r"^[A-Za-z0-9_]{3,16}$")
BEDROCK_NAME = re.compile(r"^[A-Za-z0-9 _]{1,16}$")


def mod_command(m):
    """Turn one queued action into a console command, or None if anything looks off."""
    action, edition = m.get("action"), m.get("edition")
    if action == "whitelist_on":
        return "whitelist on"
    if action == "whitelist_off":
        return "whitelist off"
    name = str(m.get("name") or "")
    if edition == "bedrock":
        if not BEDROCK_NAME.match(name):
            return None
        tag = name.replace(" ", "_")  # Floodgate uses _ for spaces in gamertags
    else:
        if not JAVA_NAME.match(name):
            return None
        tag = name
    reason = re.sub(r"[^\w .,!?¿¡-]", "", str(m.get("reason") or ""))[:100].strip()
    if action == "whitelist_add":
        return f"fwhitelist add {tag}" if edition == "bedrock" else f"whitelist add {tag}"
    if action == "whitelist_remove":
        return f"fwhitelist remove {tag}" if edition == "bedrock" else f"whitelist remove {tag}"
    target = "." + tag if edition == "bedrock" else tag  # Floodgate's prefix for Bedrock players
    if action == "ban":
        return f"ban {target} {reason}".strip()
    if action == "unban":
        return f"pardon {target}"
    return None


def sync_moderation(cfg, servers, actions, dry, site, auth):
    by_uuid = {x["uuid"]: x for x in servers}
    done = []
    for m in actions:
        x = by_uuid.get(m.get("ptero_uuid"))
        if not x:
            done.append({"id": m.get("id"), "result": "server not found"})
            continue
        if x["state"] != "running":
            continue  # try again next run
        cmd = mod_command(m)
        if not cmd:
            done.append({"id": m.get("id"), "result": "rejected"})
            continue
        if dry:
            print(f"  would run on {x['name']}: {cmd}")
            continue
        try:
            ptero_command(cfg, x["identifier"], cmd)
            done.append({"id": m.get("id"), "result": "sent"})
            print(f"  {x['name']}: {cmd}")
        except Exception as e:
            print(f"  {x['name']}: couldn't run '{cmd}' ({e})", file=sys.stderr)
    if done:
        time.sleep(2)  # let the server write whitelist.json / banned-players.json

    lists = {}
    for x in servers:
        ident = x["identifier"]
        props = ptero_text(cfg, ident, "/server.properties")
        if props is None:
            continue  # not a Minecraft server
        try:
            wl = json.loads(ptero_text(cfg, ident, "/whitelist.json") or "[]")
            bans = json.loads(ptero_text(cfg, ident, "/banned-players.json") or "[]")
        except ValueError:
            continue
        lists[x["uuid"]] = {
            "whitelist_on": any(l.strip() == "white-list=true" for l in props.splitlines()),
            "whitelist": [{"name": e.get("name")} for e in wl if isinstance(e, dict)],
            "bans": [{"name": e.get("name"), "reason": e.get("reason"), "source": e.get("source")} for e in bans if isinstance(e, dict)],
        }
    if dry:
        print(json.dumps({"done": done, "lists": lists}, indent=2)[:4000])
        return
    http_json(site + "/api/sync/moderation", auth, {"done": done, "lists": lists})


def stat_value(stats, key):
    cat, _, item = key.partition("/")
    return (stats.get(cat) or {}).get(item, 0)


CATALOG_PER_CATEGORY = 60  # most common items per stat category (mined, crafted, killed…) sent to the site


def collect_players(cfg, servers, want_stats, want_adv, catalog=None):
    """catalog: dict to fill with {ptero_uuid: {"stats": {key: [players, max]}, "advancements": {id: players}}}."""
    players, rows = {}, []
    for x in servers:
        ident = x["identifier"]
        props = ptero_text(cfg, ident, "/server.properties")
        if props is None:
            continue  # not a Minecraft server
        world = "world"
        for line in props.splitlines():
            if line.startswith("level-name="):
                world = line.split("=", 1)[1].strip() or "world"
        try:
            for entry in json.loads(ptero_text(cfg, ident, "/usercache.json") or "[]"):
                if entry.get("uuid") and entry.get("name"):
                    players[entry["uuid"].lower()] = entry["name"]
        except ValueError:
            pass
        # Minecraft 26.1+ keeps player files in <world>/players/stats|advancements; older versions in <world>/stats|advancements
        pdir = f"/{world}/players"
        files = [f for f in ptero_list(cfg, ident, f"{pdir}/stats") if f.endswith(".json")]
        if not files:
            pdir = f"/{world}"
            files = [f for f in ptero_list(cfg, ident, f"{pdir}/stats") if f.endswith(".json")]
        cat = {"stats": {}, "advancements": {}} if catalog is not None else None
        for f in files:
            uuid = f[:-5].lower()
            try:
                st = json.loads(ptero_text(cfg, ident, f"{pdir}/stats/{f}") or "{}").get("stats", {})
            except ValueError:
                continue
            custom = st.get("minecraft:custom", {})
            ticks = custom.get("minecraft:play_time", custom.get("minecraft:play_one_minute", 0))
            adv_done = []
            if want_adv or cat is not None:
                try:
                    adv = json.loads(ptero_text(cfg, ident, f"{pdir}/advancements/{f}") or "{}")
                    adv_done = [k for k in want_adv if isinstance(adv.get(k), dict) and adv[k].get("done")]
                    if cat is not None:
                        for k, v in adv.items():
                            if ":recipes/" not in k and isinstance(v, dict) and v.get("done"):
                                cat["advancements"][k] = cat["advancements"].get(k, 0) + 1
                except ValueError:
                    pass
            if cat is not None:
                for category, items in st.items():
                    if isinstance(items, dict):
                        for item, val in items.items():
                            if isinstance(val, (int, float)) and val > 0:
                                e = cat["stats"].setdefault(f"{category}/{item}", [0, 0])
                                e[0] += 1
                                e[1] = max(e[1], int(val))
            rows.append({
                "uuid": uuid, "ptero_uuid": x["uuid"], "play_minutes": int(ticks) // 1200,
                "stats": {k: stat_value(st, k) for k in want_stats}, "advancements": adv_done,
            })
        if cat is not None and files:
            # keep every minecraft:custom stat, and the most common items of the other categories
            by_cat = {}
            for k, (n, mx) in cat["stats"].items():
                by_cat.setdefault(k.split("/", 1)[0], []).append((k, n, mx))
            keep = {}
            for c, lst in by_cat.items():
                lst.sort(key=lambda e: (-e[1], -e[2]))
                for k, n, mx in (lst if c == "minecraft:custom" else lst[:CATALOG_PER_CATEGORY]):
                    keep[k] = [n, mx]
            catalog[x["uuid"]] = {"players": len(files), "stats": keep, "advancements": cat["advancements"]}
        print(f"  {x['name']}: {len(files)} player stat file(s)")
    return [{"uuid": u, "name": n} for u, n in players.items()], rows


# --- Ocaso (Skript) ---------------------------------------------------------------------------
# Reads plugins/Skript/variables.csv (Skript's saved variables) and logs/latest.log (deaths) and
# sends a small summary to /api/sync/ocaso. Only servers that have Ocaso's variables are sent.

DIOSES = ["tonatiuh", "tlaloc", "quetzalcoatl", "mictlan", "tezcatlipoca"]
DEATH_RE = re.compile(
    r"^\[(\d\d):(\d\d):(\d\d) INFO\]: (?:System chat: |\[Not Secure\] )?([.\w]{2,20}) "
    r"((?:was|were|fell|drowned|burned|blew|hit|went|walked|tried|died|starved|suffocated|froze|withered|"
    r"experienced|discovered|didn't|left|got|squashed)\b.*)$")


def skript_value(typ, hexval):
    try:
        b = bytes.fromhex(hexval.strip())
    except ValueError:
        return None
    if typ == "boolean":
        return bool(b and b[-1])
    if typ in ("long", "date", "timespan"):
        return int.from_bytes(b[-8:], "big", signed=True) if len(b) >= 8 else None
    if typ == "integer":
        return int.from_bytes(b[-4:], "big", signed=True) if len(b) >= 4 else None
    if typ == "short":
        return int.from_bytes(b[-2:], "big", signed=True) if len(b) >= 2 else None
    if typ == "byte":
        return int.from_bytes(b[-1:], "big", signed=True) if b else None
    if typ == "double":
        return round(struct.unpack(">d", b[-8:])[0], 2) if len(b) >= 8 else None
    if typ == "float":
        return round(struct.unpack(">f", b[-4:])[0], 2) if len(b) >= 4 else None
    if typ == "string":
        # Skript may prefix the text with a length; keep the readable part
        txt = b.decode("utf-8", "ignore")
        runs = re.findall(r"[\w\- .,áéíóúñÁÉÍÓÚÑ]+", txt)
        return max(runs, key=len).strip() if runs else ""
    return None


def parse_skript_vars(text):
    out = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = [x.strip() for x in line.rsplit(",", 2)]
        if len(parts) != 3:
            continue
        name, typ, val = parts
        if name.startswith('"') and name.endswith('"'):
            name = name[1:-1].replace('""', '"')
        if name.startswith("ocaso::") or name.startswith("sanity::"):
            v = skript_value(typ, val)
            if v is not None:
                out[name] = v
    return out


def ocaso_summary(vars_):
    pl = {}
    def P(u):
        return pl.setdefault(u.lower(), {"fe": {}})
    for k, v in vars_.items():
        parts = k.split("::")
        if parts[0] == "sanity" and len(parts) == 2:
            P(parts[1])["sanity"] = v
        elif parts[:2] == ["ocaso", "fe"] and len(parts) == 4 and parts[3] in DIOSES:
            P(parts[2])["fe"][parts[3]] = v
        elif parts[:2] == ["ocaso", "orden"] and len(parts) == 3:
            P(parts[2])["orden"] = v
        elif parts[:2] == ["ocaso", "clase"] and len(parts) == 3:
            P(parts[2])["clase"] = v
        elif parts[:2] == ["ocaso", "bautizado"] and len(parts) == 3:
            P(parts[2])["bautizado"] = True
        elif parts[:2] == ["ocaso", "lunas"] and len(parts) == 3:
            P(parts[2])["lunas"] = v
        elif parts[:2] == ["ocaso", "llave"] and len(parts) == 3:
            P(parts[2])["llave"] = True
        elif parts[:3] == ["ocaso", "mictlan", "nivel"] and len(parts) == 4:
            P(parts[3])["mictlan"] = v
        elif parts[:3] == ["ocaso", "mictlan", "senor"] and len(parts) == 4:
            P(parts[3])["senor"] = True
    noches = vars_.get("ocaso::noches") or 0
    world = {"noches": noches, "lunasangre": bool(vars_.get("ocaso::lunasangre")),
             "xolotl_vivo": bool(vars_.get("ocaso::xolotl::vivo")),
             "mictlantecuhtli_vivo": bool(vars_.get("ocaso::mictlantecuhtli::vivo")),
             "llorona_viva": bool(vars_.get("ocaso::llorona::viva"))}
    # only real player UUIDs
    players = {u: d for u, d in pl.items() if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", u)}
    return world, players


def parse_deaths(log, names):
    from datetime import datetime, timedelta
    now = datetime.now()
    out = []
    for line in log.splitlines()[-4000:]:
        m = DEATH_RE.match(line.strip())
        if not m:
            continue
        h, mi, se, name, msg = m.groups()
        if name.lower() not in names or "advancement" in msg:
            continue
        t = now.replace(hour=int(h), minute=int(mi), second=int(se), microsecond=0)
        if t > now + timedelta(minutes=2):
            t -= timedelta(days=1)  # the log started yesterday
        out.append({"name": names[name.lower()][1], "uuid": names[name.lower()][0], "message": msg[:200],
                    "at": int(t.timestamp() * 1000)})
    return out[-60:]


def sync_ocaso(cfg, servers, dry, site, auth):
    payload = []
    for x in servers:
        if x.get("state") not in ("running", "starting", "stopping", "offline"):
            continue
        ident = x["identifier"]
        text = ptero_text(cfg, ident, "/plugins/Skript/variables.csv")
        if not text or "ocaso::" not in text:
            continue
        world, players = ocaso_summary(parse_skript_vars(text))
        names = {}
        try:
            for e in json.loads(ptero_text(cfg, ident, "/usercache.json") or "[]"):
                if e.get("uuid") and e.get("name"):
                    names[e["name"].lower()] = (e["uuid"].lower(), e["name"])
        except ValueError:
            pass
        for u, d in players.items():
            d["name"] = next((n for (uu, n) in names.values() if uu == u), None)
        deaths = parse_deaths(ptero_text(cfg, ident, "/logs/latest.log") or "", names)
        payload.append({"ptero_uuid": x["uuid"], "world": world, "players": players, "deaths": deaths})
        print(f"  {x['name']}: Ocaso — {len(players)} player(s), {len(deaths)} death(s) in the log, night {world['noches']}")
    if not payload:
        return
    if dry:
        print(json.dumps({"servers": payload}, indent=2, ensure_ascii=False)[:6000])
        return
    res = http_json(site + "/api/sync/ocaso", auth, {"servers": payload})
    print(f"Synced Ocaso: {res.get('players', 0)} player(s), {res.get('new_deaths', 0)} new death(s)")


def stats_due(cfg, name=".last_stats_sync", minutes=None):
    path = os.path.join(HERE, name)
    try:
        last = os.path.getmtime(path)
    except OSError:
        last = 0
    return time.time() - last >= (minutes or cfg["STATS_EVERY_MIN"]) * 60 - 30, path


def main():
    cfg = load_config()
    dry = "--dry" in sys.argv
    servers = collect(cfg)
    site = cfg["SITE_URL"].rstrip("/")
    auth = {"Authorization": f"Bearer {cfg['SYNC_SECRET']}"}

    if dry:
        print(json.dumps({"servers": servers}, indent=2))
    else:
        res = http_json(site + "/api/sync", auth, {"servers": servers})
        print(f"Synced {res.get('received')} server(s)")

    try:
        conf = http_json(site + "/api/sync/config", auth)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return  # site doesn't have levels yet
        raise

    if conf.get("verify"):
        send_link_codes(cfg, servers, conf["verify"], dry)

    try:
        sync_moderation(cfg, servers, conf.get("moderation") or [], dry, site, auth)
    except urllib.error.HTTPError as e:
        if e.code != 404:  # 404 = site doesn't have whitelist/bans yet
            raise

    try:
        sync_ocaso(cfg, servers, dry, site, auth)
    except urllib.error.HTTPError as e:
        if e.code != 404:  # 404 = site doesn't have the Ocaso panel yet
            print(f"Ocaso sync failed: HTTP {e.code}", file=sys.stderr)
    except Exception as e:
        print(f"Ocaso sync failed: {e}", file=sys.stderr)

    due, stamp = stats_due(cfg)
    scan_due, scan_stamp = stats_due(cfg, ".last_catalog_scan", 360)
    scan = scan_due or "--scan" in sys.argv
    if due or scan or "--stats" in sys.argv or dry:
        catalog = {} if scan else None
        players, rows = collect_players(cfg, servers, conf.get("stats", []), conf.get("advancements", []), catalog)
        if dry:
            print(json.dumps({"players": players, "stats": rows, "catalog": catalog}, indent=2)[:20000])
            return
        res = http_json(site + "/api/sync/players", auth, {"players": players, "stats": rows})
        print(f"Synced stats for {len(rows)} player/server pair(s); {res.get('quests_completed', 0)} quest(s) completed")
        with open(stamp, "w") as f:
            f.write(str(int(time.time())))
        if catalog:
            try:
                res = http_json(site + "/api/sync/catalog", auth, {"servers": catalog})
                print(f"Sent the quest-ideas catalog: {res.get('rows', 0)} stat/advancement(s)")
                with open(scan_stamp, "w") as f:
                    f.write(str(int(time.time())))
            except urllib.error.HTTPError as e:
                if e.code != 404:  # 404 = site doesn't have the catalog yet
                    raise


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} from {e.url}: {e.read()[:300].decode('utf-8', 'replace')}")
    except urllib.error.URLError as e:
        sys.exit(f"Network error: {e.reason}")
