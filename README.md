# mc.moikas.cc

Community site for the Moikas game servers. Built on Cloudflare Pages + Functions + D1 (free tier).

- **Home:** a card for each server (name, connect address, live status and players, task progress) plus announcements
- **Server page:** join info, modpack and versions, announcements and events, tasks with comment threads
- **Admin page** (`/admin`): edit server pages, link them to Pterodactyl, approve users and set roles
- **Discord login**, with roles:

| Role | Can do |
|---|---|
| pending | Everyone starts here after logging in. Read only. |
| member | Comment on tasks |
| staff | Post official announcements and events, create, edit and close tasks, delete comments |
| admin | Everything above, plus edit/delete servers and change roles |

The Discord account in `ADMIN_DISCORD_ID` is always admin.

**Pterodactyl data** (name, port, online/offline, player count, Minecraft/loader versions) comes from
`sync/ptero-sync.py`, which runs on the NAS every 2 minutes and *pushes* to the site. Your panel stays private.
Manual fields on the admin page always override what Pterodactyl reports.

---

## Setup (one time, ~20 minutes)

### 1. Discord app (for login)
1. https://discord.com/developers/applications → **New Application** → name it "Moikas MC".
2. **OAuth2** page: copy the **Client ID**, then **Reset Secret** and copy the **Client Secret**.
3. Under **Redirects**, add `https://mc.moikas.cc/auth/callback` and save.
4. Get your own Discord user ID: Discord → Settings → Advanced → turn on **Developer Mode**, then right-click your name → **Copy User ID**.

### 2. Database (D1)
1. Cloudflare dashboard → **Storage & Databases → D1 → Create** → name it `moikas-mc`.
2. Copy its **Database ID**.
3. Open the database → **Console**, paste all of `schema.sql`, and run it.

### 3. Fill in `wrangler.toml`
Replace the three `PUT_..._HERE` values: your Discord user ID, the Discord Client ID, and the D1 Database ID.

### 4. Push to GitHub, create the Pages project
1. Push this folder to a new repo (e.g. `SoyMoikas/mc-moikas-site`).
2. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
   Framework preset **None**, build command **empty**. The output folder (`public`) and D1 binding come from `wrangler.toml`.
3. After it's created: project → **Settings → Variables and Secrets** → add two **Secrets**:
   - `DISCORD_CLIENT_SECRET`: from step 1
   - `SYNC_SECRET`: a long random string. Generate one with `openssl rand -hex 32` on the NAS.
4. **Deployments** → retry the latest deployment so it picks up the secrets.

### 5. Custom domain
Project → **Custom domains → Set up a domain** → `mc.moikas.cc`.
Cloudflare will replace the existing `mc` A record with a CNAME. Allow it.
Minecraft keeps working through the `_minecraft._tcp.mc` SRV record → `play.moikas.cc:25565`.

### 6. Log in
Go to https://mc.moikas.cc → **Log in with Discord**. Your account is admin automatically.
Open **Admin → Servers → SkyFactory** and fill in the pack version.

### 7. Pterodactyl sync on the NAS
1. In Pterodactyl: top-right **Account → API Credentials** → create a key (starts with `ptlc_`).
   The key stays on the NAS. For the strictest setup, create a separate Ptero user, add it as a
   subuser on each server with only *Startup → Read* permission, and make the key from that user.
2. Copy the `sync/` folder to the NAS, e.g. `/mnt/tank/scripts/ptero-sync/`.
3. `cp sync.env.example sync.env`, fill it in (panel URL as the NAS sees it, key, same `SYNC_SECRET`), then `chmod 600 sync.env`.
4. Test it: `python3 ptero-sync.py --dry` (shows what would be sent), then `python3 ptero-sync.py`.
5. TrueNAS → **System → Advanced Settings → Cron Jobs → Add**
   - Command: `python3 /mnt/tank/scripts/ptero-sync/ptero-sync.py`
   - Run as: `root` (or any user that can read `sync.env`)
   - Schedule: custom `*/2 * * * *`
   - Hide standard output: on
6. **Admin → Pterodactyl sync** now lists your servers. Click **Create page** for a new one, or link
   SkyFactory to its Ptero server from its edit form.

Only the egg variables listed in the script (versions and loaders) are sent. RCON passwords and API keys
in your eggs never leave the NAS.

---

## Languages (English / Spanish)
The site picks Spanish for anyone whose browser is in Spanish; everyone can switch with the EN/ES button.
UI text lives in `public/js/i18n.js`. Each server has optional Spanish description and join steps (Admin → Edit).
Announcements, tasks and comments are shown as written.

Database updates for existing installs: run each `migrations-00X-*.sql` file you haven't run yet, once, in the D1 console (001 = Spanish fields, 002 = chat, 003 = levels & quests).

## Levels & quests
- XP = 1 per minute played on any server (from each world's `stats/<uuid>.json`) + quest XP. Level L needs 30·L² XP.
- Players link their Minecraft account on their profile; the NAS script `/tell`s them a 6-digit code in-game.
- Automatic quests check advancements (`minecraft:story/mine_diamond`) or statistics (`minecraft:mined/minecraft:stone` ≥ N).
  Manual quests are submitted by players and approved by staff on the Quests page.
- The sync script reads stats through Pterodactyl's file API every 10 minutes (`STATS_EVERY_MIN` in sync.env).

## Adding another server later
1. Create it in Pterodactyl, giving it its own port (e.g. 25566).
2. Within 2 minutes it shows up under **Admin → Pterodactyl sync** → **Create page**.
3. Fill in modpack name/version/link, untick **Draft**, save. It appears as a card on the home page.

Players will see `play.moikas.cc:25566`. For a clean name with no port, add a Cloudflare SRV record
`_minecraft._tcp.atm` → `play.moikas.cc` port `25566`, and set **Exact connect text** to `atm.moikas.cc`.
Remember to port-forward the new port on the eero.

## Local development (optional)
```
npm install
cp .dev.vars.example .dev.vars          # fill in
npx wrangler d1 execute moikas-mc --local --file=schema.sql
npx wrangler pages dev
```
Discord login needs `http://localhost:8788/auth/callback` added as a redirect in the Discord app.
