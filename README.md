# CROWN//CRISIS — V35 Smooth Multiplayer Beta

This performance-focused update builds on V34. It retains the 15-wave Campaign, 500+ wave Endless Survival, Normal/Hard/Insanity, solo play, four-player rooms, eight unique fighters, bosses, rare pickups, shops, achievements, leaderboard, and V34's two-minute reconnect recovery.

## What's different in V35

- **Lean network snapshots:** The host sends the fields guests need to render aliens and projectiles, without shipping enemy navigation, collision, targeting, and weapon-hit internals. In an artificial test with 165 aliens and 220 shots, the snapshot shrank from 101,924 characters to 58,199 (about 43%). Actual results vary by wave.
- **Adaptive sync:** A lighter scene can receive roughly 14 host snapshots per second. Massive hordes deliberately use a slower rate so the network does not become saturated. The server relays only the newest frames when a guest's connection is congested.
- **Smooth motion:** Guests visually interpolate enemy positions, bullets, and teammates between authoritative updates rather than jumping abruptly each time a packet arrives.
- **Responsive guest controls:** A guest's local character starts visually moving as soon as they press WASD, then smoothly corrects toward the host-authoritative position. Collisions, health, gold, waves, and damage are still computed by the host. This is an early prediction system, not a fully lag-free netcode rewrite.
- **Less per-frame work:** Enemy/projectile collision first rejects distant targets using a cheap bounding check; line-of-sight checks avoid temporary arrays; navigation-grid refreshes are spaced out slightly during massive hordes.
- **Live quality display:** The multiplayer HUD displays game FPS, estimated ping on a guest, and incoming KB/s to help identify why a particular computer or connection stutters.
- **No change to the actual game economy or difficulty.**

## Upload V35 to your existing GitHub / Render service

**You need to replace BOTH `server.js` and `public/index.html`.** The update won't be effective if one computer is still running the previous HTML.

1. Download and **extract** `crown_crisis_v35_smooth_multiplayer_render.zip` on your computer. Don't upload the ZIP itself to GitHub.
2. Open your existing repository at https://github.com/goochandrew79-ai/crown-crisis-coop1.
3. At the root of the repository, replace **`server.js`** and **`package.json`** with the files from this update. You may replace `README.md` and `BETA_TEST_CHECKLIST.md` too.
4. Click the **`public`** folder. Replace the existing **`index.html`** in that folder with the new **`public/index.html`** from the ZIP. Commit all changes.
5. In https://dashboard.render.com/, open your existing Crown Crisis web service and watch the deployment. If needed, choose **Manual Deploy → Deploy latest commit**.
6. When the deployment says **Live**, have **everyone** visit https://crown-crisis-coop.onrender.com/ and refresh using **Ctrl + Shift + R**. Start a fresh multiplayer match.

Keep exactly this layout:

```text
crown-crisis-coop1/
  server.js
  package.json
  README.md
  BETA_TEST_CHECKLIST.md
  public/
    index.html
```

## How to read the in-game stats

- **FPS**: Frames per second on that player’s browser. Sustained values below roughly 40 point to the browser/PC struggling to render. If the HOST's FPS is low, *everyone's* simulation may be delayed because the host browser runs all enemy AI and bullet collision.
- **PING (ms)**: Approximate round-trip time to Render. If it is regularly over 150–200 ms or fluctuates strongly, network/hosting latency is likely contributing to sluggish controls.
- **KB/s**: Approximate inbound multiplayer traffic; it can rise during large alien hordes. It is an estimate, not a precise bandwidth meter.

For better results, play on a stable network (wired connection is ideal), close other high-load tabs, keep the host's game tab active, and avoid streaming/screensharing from the computer running the host simulation during intense hordes.

## Known limitations

- **This improves network traffic and animations; it does not remove physical internet latency.** The host-controlled architecture still has higher response time for guests than a dedicated authoritative game server. A future major rewrite could move enemy simulation to the server with rollback/prediction.
- A Render Free instance has limited compute/resources and may restart; the host's own computer runs the simulation. Your friends' geographic distance from the chosen Render region matters.
- V34 reconnection handles *temporary internet interruptions*, not a full Render restart or closing/reloading the host's browser tab. Rejoin within the two-minute window, without closing the tab.
- Snapshots remain authoritative for damage and hits. A predicted visual position can be briefly corrected if the guest and host diverge, especially during dashes or packet loss.

## Local testing performed

- JavaScript syntax checks for both browser game and Node server.
- Four-player local WebSocket relay: Insanity start, three guest inputs, large state broadcast to all three, repeated state delivery, ping timing.
- Guest/host Chromium rendering under simulated multiplayer: snapshots, local movement prediction, 165-enemy / 220-projectile stress scene, no page errors.
- Guest and host two-minute reconnection regression tests with the same player IDs and room, resynchronization and messages after reconnect.

A full public-Internet performance test on your Render account, across four real computers and hundreds of Endless waves, has **not** been run here. Use the included checklist to gather FPS, ping and wave number if problems continue.
