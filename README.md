# CROWN//CRISIS — BETA V33: RARE TEMPORARY POWERUPS

This is a targeted update to V32. Keep your existing GitHub repository and Render service.

## What changed

- **Endless Survival upgrade ranks remain uncapped**, with increasing prices and diminishing bonuses. The original six primary-gun unlock tiers remain intact. Higher ranks provide small additional improvements instead of a new weapon each time.
- After an ordinary alien dies, there is a **0.75% chance** of a temporary pickup. Bosses do not have this random drop rule.
- Pickups must be collected by walking over them; they disappear after **8 seconds** on the ground. Up to seven can exist at once. They do not give money and do not increase permanent upgrade ranks.
- All pickup effects last about **2.6–2.9 seconds** and do not stack multiplicatively; another pickup of the same type refreshes the timer.

| Pickup | Effect | Duration |
|---|---|---|
| Power Shot (red) | 12% more damage for friendly projectiles | 2.6 seconds |
| Overclock (gold) | 17% faster primary fire rate | 2.6 seconds |
| Sprint (green) | 18% faster movement | 2.7 seconds |
| Double Dash (blue) | Two quick successive dashes | 2.9-second activation window |

In co-op, the room host chooses random drops and checks pickup collection. Only the first player to reach a pickup receives its effect. Other players see the pickup and the receiving fighter's active effect through synchronized snapshots.

## Update the GitHub / Render game

1. Extract `crown_crisis_v33_powerups_render.zip`.
2. In your existing repository **https://github.com/goochandrew79-ai/crown-crisis-coop1**, replace these files in the same locations:

       crown-crisis-coop1/
         server.js
         package.json
         README.md
         public/
           index.html

3. Commit all changes. If uploading to GitHub's website does not overwrite an existing file, open that file, use the editor, and paste the replacement content; for the large HTML file, GitHub Desktop is easier (clone → copy over → commit → push).
4. Visit **https://dashboard.render.com/**. Wait for an automatic deployment or select **Manual Deploy → Deploy latest commit**.
5. When status is **Live**, press **Ctrl+Shift+R** on **https://crown-crisis-coop.onrender.com/** to load the new game.
6. Test solo and multiplayer: check red/yellow/green/blue diamonds, collect one, and look for its timer near the bottom of the game display.

**Important:** This is a random feature: seeing no pickups in a short session is normal. Around 133 regular monster kills are expected per pickup on average, but randomness can vary greatly. The game needs the server for multiplayer. Opening `public/index.html` directly still supports solo play.

## Beta tests to run

- Solo, Normal and Hard; Campaign and Endless: collect each pickup and confirm expiration.
- Co-op: have both players approach one drop; only one player should receive the buff. Confirm the guest sees the pickup spawn and disappear.
- Test Double Dash with two presses of Dash within 2.9 seconds.
- Open an Endless shop with high-rank upgrades: price increases and no hard cap.
- Verify a new wave removes uncollected pickups, and older characters/abilities still work.

Additional existing V32 rules, difficulty multipliers, achievements, leaderboard and browser resizing are preserved.
