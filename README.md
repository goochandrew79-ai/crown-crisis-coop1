# CROWN//CRISIS — V31 · ENDLESS SURVIVAL + CO-OP

A self-contained, pixel-art alien shooter with solo and four-player online play.
**This is a complete replacement for the existing V30 GitHub project, not an additional subfolder.**

## Quick upgrade: your existing GitHub + Render site

Your repository shown earlier: https://github.com/goochandrew79-ai/crown-crisis-coop1
Your Render website: https://crown-crisis-coop.onrender.com/

1. Download and **Extract All** from `crown_crisis_v31_endless_coop_render.zip`.
2. In your existing GitHub repository, open the **Code** tab.
3. At the repository root, choose **Add file -> Upload files**. Upload the new `server.js`, `package.json`, and `README.md` from the extracted folder (replace the old versions). Select **Commit changes**.
4. Click the existing **public** folder in GitHub, then choose **Add file -> Upload files**. Upload the new `index.html` found inside the extracted `public` folder. Commit changes.
5. Confirm GitHub looks like this (folder order does NOT matter):

       crown-crisis-coop1/
         public/
           index.html
         package.json
         server.js
         README.md

6. Render normally redeploys when GitHub changes. If it does not, go to **Render -> your Web Service -> Manual Deploy -> Deploy latest commit**. Wait until the event says **Live** and refresh your Render URL (Ctrl+Shift+R).
7. You do **not** need to create a new Render app, buy a domain, or change `npm start`.

If GitHub complains about the upload, do Step 3 and Step 4 separately as above. Do not upload the ZIP itself to the repository.

## Play

- **15-Wave Campaign:** Original mode, all eight characters, unlock campaign medals as usual.
- **Boss Rush:** The final Shark boss, now substantially tougher than before.
- **Endless Survival:** Click the gold **ENDLESS SURVIVAL** button on the menu. Alien speed, health, damage, numbers, and elite frequency grow as you reach higher waves. Waves are not capped: play toward 250, 500, and beyond until defeated.
- **Survival bosses:** Overmind every 10th wave except the Shark encounter every 25th wave. The Shark is much tougher and returns with a radial bullet barrage.
- **Between-wave shopping:** Shops after wave 3 and then every five cleared waves; the rest of the waves restart automatically after a brief breather.
- **4-player Endless:** Open **ONLINE CO-OP**, select **Match type -> Endless Survival**, share the room code, everyone presses Ready, then host starts. Each player keeps their own gold, upgrades, and unique abilities. Squad revive is hold R near a fallen teammate.
- **Scores:** Open **SURVIVAL SCORES** on the main menu. Enter a nickname there *before* playing solo, if you want your name on the board. Rank is based on **highest wave reached**, with total score as the tie breaker. Solo and co-op scores can be filtered.
- **End of run:** The game-over screen displays wave reached, waves cleared, kills, and score. You can take screenshots and post them to Discord even when the leaderboard isn't available.

Survival runs **do not** award the original 15-wave campaign achievements. Boss Rush also stays separate.

## Leaderboard on free Render hosting

The online leaderboard works immediately with no extra signup. **Without external storage, it is TEMPORARY.** Render Free's web service filesystem and server memory are reset when it restarts, redeploys, or spins down. So scores will disappear. The game warns about this on its Scores screen.

### Make scores survive restarts for $0 with Upstash Redis (optional, recommended)

1. Create a free account at https://upstash.com/ and create a **Redis** database on its **Free** tier.
2. Open the database details and locate its **REST URL** and **REST TOKEN**. Keep the token secret.
3. Go to your Render Web Service -> **Environment** -> **Add Environment Variable**.
4. Add these two variables, inserting your actual credential values:

       UPSTASH_REDIS_REST_URL   https://YOUR-DATABASE.upstash.io
       UPSTASH_REDIS_REST_TOKEN YOUR_SECRET_TOKEN

5. Save / deploy the environment changes. The game now reports **Persistent scores enabled** when the database responds.

**Never paste the REST token into GitHub, into a screenshot, or into this chat.** Store it only as a Render environment variable. This project intentionally has no local `config.json` with secrets.

Official documentation: https://upstash.com/docs/redis/features/restapi and https://render.com/docs/free

If Redis is unavailable, the leaderboard safely falls back to the temporary server-memory board. This is a friendly competition board, **not tamper-proof**: scores originate from the player's own browser or the co-op host's simulation. For prized competitions, use screenshots and moderator review.

## Run locally (optional)

Install Node.js 18 or newer, open a terminal in this folder, and run:

    npm start

Open http://localhost:3000/ in a browser. To change the port, set `PORT` as an environment variable.

This project uses **no runtime npm dependencies**; Node's built-in HTTP and WebSocket support in this code handle up to four players per room. The host is authoritative for enemy movement and shared combat. If the host disconnects, the room closes. This is a prototype intended for friends, not a cheat-proof dedicated server.

## Developer / QA notes

- `server.js` — HTTP server, WebSocket rooms, and optional persistent leaderboard API.
- `public/index.html` — game client with embedded artwork and gameplay; no asset CDN required.
- `GET /health` — basic server health check.
- `GET /api/leaderboard` — public scoreboard JSON, including `persistent` flag.
- `POST /api/leaderboard` — solo score submission; co-op scores are submitted by the lobby host over WebSocket.
- Scores rank by deepest wave and then points. Server keeps up to 100 records.
- The original campaign still has exactly 15 waves; Endless uses its own unbounded wave counter.
