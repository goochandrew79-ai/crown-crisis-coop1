# CROWN//CRISIS — ONLINE CO-OP (V30)

A four-player private-room cooperative build based on CROWN//CRISIS V29.
The original 15-wave campaign, eight crew characters, signature weapons,
upgrades, enemies, audio, boss, and solo mode are included.

## What this build can do

- **1–4 friends in one room:** six-character private room codes and copyable invite links.
- **Unique fighters:** no two people in the same room use the same character.
- **Shared battlefield:** the lobby creator's browser runs the existing combat simulation; the online server relays player inputs and shared snapshots.
- **Shared enemies and waves:** alien counts and HP rise with party size.
- **Separate equipment:** each player owns their gold, weapons, armor, rockets, drones, and special ability.
- **Team rewards:** everyone receives a modest share of the gold earned from kills, to avoid kill stealing and keep the V29 economy from becoming too generous.
- **Revive:** a living fighter holds **R** while standing near a downed teammate for ~1.7 seconds. The entire team downed = game over.
- **Solo mode still works:** the original Play and Boss Rush buttons still operate without an online room.
- **Achievements:** campaign wave progress is saved locally in each player's own browser. There are no online accounts or cloud saves.

## Important first-version limitations

This is **host-authoritative co-op**, not a dedicated authoritative game simulation running on Render.
The person who creates the room is the host, and **must keep the game tab open and active**.
If the host closes the browser, leaves, loses connection, or their tab is paused,
the shared run will end or freeze. There is no host migration or join-in-progress.
The online server stores rooms only in memory, so Render restarts clear all active rooms.
A replay/attempt from the end screen is controlled by the host.
Mobile browsers may work, but desktop keyboard/mouse is the primary target.

### Keyboard/mouse controls

- **WASD / arrow keys:** move
- **Mouse:** aim (only custom crosshair in combat)
- **Left click / J:** fire
- **E / K / right click:** character special ability
- **Shift / Space:** dash
- **R:** revive a downed nearby teammate (hold)
- **P / Escape:** pause (host controls online pause)
- **M:** mute sound
- **C:** auto fire (host/local controls)

## Upload to GitHub and Render (no code edits needed)

### 1. Extract the ZIP

Unzip the download on your computer. The **root of the extracted project** must look like this:

```text
crown-crisis-coop/
├── package.json
├── server.js
├── README.md
└── public/
    └── index.html
```

**Do not upload only the HTML file, and do not deploy it as a Static Site.** The multiplayer rooms need the Node.js server (`server.js`).

### 2. Create a GitHub repository

1. Sign in at https://github.com and create a new repository named `crown-crisis-coop`.
2. In the empty repo, choose **Add file → Upload files** (or follow the upload link GitHub displays).
3. Drag **all the extracted contents** into the upload page, including the `public` folder. GitHub supports dragging folders.
4. Confirm that the files look exactly like the tree above; in particular, `public/index.html` must be inside `public`.
5. Choose **Commit changes** to save them in your repo.

If uploading a folder is inconvenient, install GitHub Desktop (https://desktop.github.com), create a repository in the extracted folder, and publish it to GitHub.

### 3. Deploy to Render for free

1. Visit https://dashboard.render.com/ and sign in (GitHub login works).
2. Choose **New → Web Service**.
3. Connect your GitHub account and select the `crown-crisis-coop` repository.
4. Fill in these settings:

| Render setting | Enter |
|---|---|
| **Name** | `crown-crisis-coop` (or another unused name) |
| **Language / Runtime** | `Node` |
| **Branch** | `main` |
| **Root Directory** | leave **blank** |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type / Plan** | `Free` |

5. Click **Deploy Web Service / Create Web Service**.
6. When Render reports **Live**, open the HTTPS address it provides, such as `https://YOUR-SERVICE-NAME.onrender.com`.
7. The game's character-select screen should appear with a **🌐 ONLINE CO-OP** button.

The server respects Render's `PORT` environment variable and binds to `0.0.0.0`; no database or secret keys are required. There is no subscription charge **provided you remain within Render's free usage limits**.

### 4. Invite your friends

1. On your Render URL, click **ONLINE CO-OP**.
2. Enter your nickname, choose a character, and click **CREATE PRIVATE ROOM**.
3. Copy the invite link or read out the six-character code.
4. Up to **three friends** open the **same Render URL**, click **ONLINE CO-OP**, select a different character, and join with the code.
5. Each guest clicks **READY UP**. When all players are ready, the host presses **START 15-WAVE CO-OP**.
6. Fight aliens together! Between waves, **each person buys their own upgrades** and the **host** launches the next wave.

You can start with only one or two people; you do not need a full four-player squad.

### 5. Hosting and free-tier notes

- A free Render web service may **spin down after 15 minutes without inbound traffic or WebSocket messages**. The first connection after it sleeps can take about a minute to wake it.
- Render currently includes **750 free instance-hours per workspace/month** and applies other bandwidth/build allowances. Check your Render dashboard before relying on it for frequent play.
- Free instances may restart. Any active rooms are lost when the process restarts, because this project deliberately does not require a database.
- The room creator's **computer**, not Render, does most of the enemy physics and combat simulation. Keep the host tab open. If a room freezes, have everyone refresh and create a new room.
- There is **no public matchmaking**, password/login system, dedicated server host, cloud save or anti-cheat. Room codes are private invitations among friends, not a security boundary.

## Test locally before uploading (optional)

Install Node.js 18 or newer from https://nodejs.org and open a terminal in the folder containing `server.js`:

```bash
npm start
```

Then open **http://localhost:3000**. For a local multiplayer test, use two separate browser windows/tabs and create/join the same room code. This does **not** let internet friends connect unless you deploy the server. Opening `public/index.html` directly as a `file://` page is not sufficient for online play.

Optional health check: `http://localhost:3000/health` or `https://your-service-name.onrender.com/health` should return `{ "ok": true, "rooms": 0 }` when no rooms are open.

## Updating the game later

Replace `public/index.html` and (if networking changes) `server.js` with the newer files. Commit the changes to GitHub; Render usually auto-deploys on the selected branch. Active rooms will disconnect when the service restarts, so update between game nights.

## Technical overview

- Frontend: single self-contained HTML5 canvas game, updated for multiplayer.
- Backend: one built-in-Node `http` + RFC 6455 WebSocket relay, no dependencies.
- Match simulation: the lobby creator/browser. Input messages travel to host; the host sends world snapshots back to the other players about 10 times/sec.
- Privacy: nicknames, room codes, and controls are transmitted to the shared server; no accounts or chat history are stored. Local achievements and audio preferences remain in browser localStorage.
- Rendering and abilities: reuse the original V29 sprites, collision, pickups, specials, and map artwork.
