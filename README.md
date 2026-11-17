# CROWN//CRISIS — V39 Invite & Lobby Reliability Fix

This release corrects a bug in the previous server where a momentary WebSocket disconnect removed a player from a **pre-game lobby immediately**. If that player was the host, the room code disappeared, leaving invite links unusable and producing `resume_failed` messages.

## What's changed

- Invited friends automatically attempt to join the room from `https://YOUR-RENDER-URL/?room=ABC123` (instead of only having the code prefilled).
- Create/Join requests retry for an extended period if Render is slow to wake up or the connection is interrupted before the room's roster is confirmed. Server-side token matching makes retries idempotent, so a second request does not create duplicate rooms or players.
- Lobby seats, including the host's, now remain reserved for **two minutes** if disconnected, just like in-game seats. The lobby shows `RECONNECTING` for those players.
- Start is blocked until **all players are connected and Ready**.
- Server logs `[create]`, `[join]`, `[join-failed]`, `[resume]`, and `[resume-failed]` to expose room failures.
- The current V38 combat, ghosts, shops, performance and gameplay are unchanged.

## Install / update your current Render service

1. Extract this ZIP. Do **not** upload the ZIP as a file to GitHub.
2. In your GitHub repository, replace the root-level `server.js` and `package.json` (and optionally `README.md`).
3. Open GitHub's `public` folder; replace `index.html` inside that folder.
4. Commit changes. In Render, deploy the latest commit and check that deployment is Live.
5. Have all players hard-refresh with Ctrl+Shift+R and **create a fresh lobby**. A pre-existing lobby cannot survive a Render redeploy.
6. Copy an invite via the in-game **COPY INVITE LINK** button. Every player must use exactly the same Render domain; e.g. `crown-crisis-coop1.onrender.com` and `crown-crisis-coop.onrender.com` are **different** servers and cannot share room codes.

**Hosting caveats:** In-memory rooms do not survive server restarts or scaling across two Render instances. Run a single instance for now. A host browser tab reload also loses its active game simulation; reconnect without reloading the tab.

For a beta test, invite a friend, temporarily toggle host Wi-Fi off/on *before starting*, verify the room survives, and then start a co-op match. Repeat while a match is running.
