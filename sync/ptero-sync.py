#!/usr/bin/env python3
"""
Pushes Pterodactyl server info to the website (mc.moikas.cc/api/sync).

Runs on the NAS (TrueNAS cron job). Talks to the Pterodactyl panel over your LAN,
pings each Minecraft server for its player count, then sends a small JSON summary
to the site. Your panel and API key never leave the house. Python 3 stdlib only.

Config: sync.env next to this script (see sync.env.example).
Usage:  python3 ptero-sync.py          # run once (cron calls this)
        python3 ptero-sync.py --dry    # print what would be sent, don't send
"""
import json
import os
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
    for k in ("PTERO_URL", "PTERO_KEY", "SITE_URL", "SYNC_SECRET", "PING_HOST", "VARIABLES"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    missing = [k for k in ("PTERO_URL", "PTERO_KEY", "SITE_URL", "SYNC_SECRET") if not cfg.get(k)]
    if missing:
        sys.exit(f"Missing config: {', '.join(missing)} (set them in {path})")
    cfg.setdefault("PING_HOST", "127.0.0.1")
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


def ptero(cfg, path):
    return http_json(cfg["PTERO_URL"].rstrip("/") + path, {
        "Authorization": f"Bearer {cfg['PTERO_KEY']}",
        "Accept": "Application/vnd.pterodactyl.v1+json",
    })


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


def main():
    cfg = load_config()
    servers = collect(cfg)
    if "--dry" in sys.argv:
        print(json.dumps({"servers": servers}, indent=2))
        return
    res = http_json(cfg["SITE_URL"].rstrip("/") + "/api/sync",
                    {"Authorization": f"Bearer {cfg['SYNC_SECRET']}"}, {"servers": servers})
    print(f"Synced {res.get('received')} server(s)")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} from {e.url}: {e.read()[:300].decode('utf-8', 'replace')}")
    except urllib.error.URLError as e:
        sys.exit(f"Network error: {e.reason}")
