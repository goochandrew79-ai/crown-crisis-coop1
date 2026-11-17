# CROWN//CRISIS V36 — Multiplayer Connection Stability

Version 36 updates the four-player browser game and the Node.js room server. It is based on V35 and retains reconnect reservations, Normal / Hard / Insanity, Endless Survival, pickup abilities, achievements, the original combat and character selection.

## What's fixed

- **WebSocket fragmentation:** The prior custom server rejected messages that were broken into multiple WebSocket frames. The V36 server safely reassembles fragmented text messages, supports control ping/pong during fragmentation, and rejects invalid/oversized messages with documented close codes instead of silently destroying connections.
- **Reconnect retry spiral:** V35 reset retry attempts immediately after a successful resume. When a socket failed again after one second, this caused repeated rapid reconnection. V36 only resets retry backoff after the connection has stayed open for 30 seconds.
- **Better diagnostics:** Render Logs now includes `[ws-close]` with room, player ID, connection age, close code (when sent), cause, and number of frames; `[ws-protocol]`, `[ws-heartbeat-timeout]`, and `[ws-error]` distinguish possible failure sources. The browser banner also displays the WebSocket close code, and browser DevTools logs a useful message.

This improves protocol handling and recovery. It does not prevent ordinary internet outages, Render instance replacement, a closed host tab, or overloaded client computers. We have not verified this deployment on the user's live Render instance.

## Update your existing GitHub / Render service

1. Download the **V36 ZIP** and extract it on your computer.
2. Open your existing GitHub repository (for example `https://github.com/goochandrew79-ai/crown-crisis-coop1`).
3. At the repository root, replace `server.js`, `package.json`, and optionally `README.md` with the V36 files, then commit the changes.
4. Open the `public` folder and replace its `index.html` with the V36 `public/index.html`; commit.
5. Verify the GitHub layout:

   ```text
   crown-crisis-coop1/
   ├── package.json
   ├── server.js
   ├── README.md
   └── public/
       └── index.html
   ```

6. In the Render dashboard, open the service and check that the new deploy is **Live**; if needed choose **Manual Deploy → Deploy latest commit**.
7. On **every player's computer**, open your Render URL and press **Ctrl+Shift+R** before starting a fresh room.
8. Use **one Render instance / replica** for this version. Rooms live only in that Node process. Multiple instances without shared state would send different participants to different rooms and break reconnection.

## How to test

1. Create a room and connect a second player.
2. Play through multiple Endless waves, especially those with lots of shots and aliens. Track whether Render Logs still shows repeated `[disconnected, reserving seat]` messages.
3. Briefly disconnect and restore **guest** Wi-Fi without closing the game tab. Player should resume into the same room within two minutes.
4. Try the same test with the host. Guests should see a host-connection warning, then the game should resume when host returns.
5. If the connection still loops, open **Render → Logs**, filter for `[ws-close]`, `[ws-protocol]`, `[ws-error]`, and `[ws-heartbeat-timeout]`, and send a screenshot showing lines *immediately before and after the disconnect*.
6. From a PC with the game open, press **F12 → Console** and look for `[CROWN//CRISIS connection] closed`. The `code`, `reason`, and `connectedForMs` values will help identify where the connection ended.

Notes: A browser close code **1006** indicates an abnormal closure without a completed close handshake; it doesn't identify the responsible network component. Code **1002** means a WebSocket protocol error, **1009** means the message was too large, and **4000** indicates the game's 42-second application ping timeout. A Render restart cannot resume in-memory game rooms.

## Run locally (optional)

Requires Node.js 18 or later:

```sh
npm install
npm start
```

Open `http://localhost:3000`. The server has a `/health` endpoint.
