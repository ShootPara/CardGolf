# CardGolf — Product Specification

Version: 1.0  
Status: Playable + deployed  
Production URL: https://cardgolf.unopenedparachute.workers.dev  
Repository: https://github.com/ShootPara/CardGolf

## 1. Overview

CardGolf is a browser-based multiplayer implementation of 6-card Golf.

The production application uses:
- a Cloudflare Worker for HTTP routing and static asset serving
- a Durable Object per table for authoritative live game state
- D1 for table rows, hygiene, and schema-backed support data
- a React + Vite frontend for the player interface

This specification is intended to describe the currently deployed application as a product, not merely a conversation handover.

---

## 2. Product Goals

- Provide a playable multiplayer 6-card Golf game in the browser
- Support creation of tables, lobby flow, live gameplay, spectators, and owner moderation
- Keep game authority on the server side
- Avoid private-information leaks during gameplay
- Support Cloudflare-native deployment and maintenance
- Keep the repository usable as the source of truth for continued development

---

## 3. Current Architecture

### 3.1 Frontend
- React + Vite single-page app
- Same-origin communication to the backend in production
- UI flow: Home → Lobby → Game

### 3.2 Backend
- Cloudflare Worker routes HTTP/API requests and serves built frontend assets
- Durable Object provides authoritative per-table game state and websocket coordination
- D1 stores table rows, hygiene, and migration-backed support data

### 3.3 Hosting
- Production target: Cloudflare Workers
- Frontend build artifacts are served by the Worker
- API routes are exposed under `/api/*`
- WebSocket routes are exposed under `/ws/*`

---

## 4. Identity and Authentication

### 4.1 Local development
- Local development may use `?dev_email=` for identity simulation

### 4.2 Production target
- Production is intended to rely on Cloudflare Access / Google identity
- Worker-side identity source is the `Cf-Access-Authenticated-User-Email` header

### 4.3 Display identity
- UI should prefer display names over raw email identity
- Display names are table-scoped and are not persisted beyond the life of the table

---

## 5. Player and Table Rules

### 5.1 Player counts
- Minimum players to start: 2
- Maximum players: 6
- No bots

### 5.2 Start gate
- New player joins are blocked after the game starts
- Spectator behavior remains subject to table rules

### 5.3 Spectators
- Spectators may join before game start
- Spectators cannot become players after game start
- Spectator chat permission is set at table creation
- Spectator chat policy is immutable after creation

---

## 6. Owner / Moderation Rules

### 6.1 Owner powers
- Mute/unmute players
- Mute/unmute spectators
- Kick players
- Kick spectators
- Delegate ownership to another player

### 6.2 Restrictions
- Owner cannot kick themselves
- Owner receives no gameplay advantage

### 6.3 Continuity rules
- If owner disconnects, ownership transfers to the oldest remaining connected player
- Leave/kick mid-game removes the participant from turn order and final-turn bookkeeping
- If only one player remains, the match ends immediately with:
  - `endedReason: all_opponents_left`

---

## 7. Game Variant

### 7.1 Variant
- 6-card Golf
- 2x3 grid
- Two-deck game
- Deck count is fixed and not configurable

Grid positions:

|1|3|5|
|2|4|6|

### 7.2 Initial reveal rule
- Initial reveal count is 2
- Rules JSON still uses the field name `initialPeekCount`
- In current reality this behaves as an **initial reveal count**, not a private peek mechanic

### 7.3 Privacy rule
- No private peeks
- All face-down cards remain hidden from everyone until revealed

### 7.4 Column rule
- If two cards in the same column match, that column scores 0
- This is always enabled
- Matching means same **rank**, not merely same point value
- Matching is evaluated at scoring time
- A player may break a potential match during play

---

## 8. Turn Flow

### 8.1 Start of game / start of round
On a player’s first turn of a round:
- the player must reveal exactly the configured initial reveal count before drawing

### 8.2 Normal start of turn
A player may:
- draw from the draw pile
- draw from the discard pile
- reveal a face-down card immediately and end the turn

### 8.3 Confirmation behavior
If a player reveals a face-down card as their first action without drawing:
- the UI shows a confirmation prompt before ending the turn

### 8.4 After drawing
After drawing, the player must:
- swap with a card in their grid, or
- discard the drawn card

### 8.5 Swapping with a face-up card
- Face-up card goes to discard
- Drawn card replaces it face-up

### 8.6 Swapping with a face-down card
- Face-down card is revealed
- That revealed card goes to discard
- Drawn card replaces it face-up

### 8.7 Discarding the drawn card
If the player discards the drawn card:
- they must reveal one face-down card
- unless PASS is legal
- the revealed card remains in place

### 8.8 Reveal without drawing
A player may reveal a face-down card without drawing
- turn ends immediately
- if this reveals their last face-down card, the round-end trigger fires

### 8.9 Final-card confirmation
When revealing the last face-down card:
- UI presents a confirmation because this action ends the round for everyone

### 8.10 Pass rule
Pass is allowed only if:
- game is not in final-turn phase
- player has exactly one face-down card remaining
- player drew during the turn
- player is discarding the drawn card
- player did not reveal a card this turn

Pass:
- ends turn
- does not reveal the final card
- does not end the round

Pass is not allowed during final-turn phase.

---

## 9. End of Round / Final Turn Phase

### 9.1 Round-end trigger
- A player intentionally reveals their last face-down card

### 9.2 Final turns
Then:
- every other player gets exactly one final turn

### 9.3 Final-turn restrictions
During final-turn phase:
- pass is disabled

### 9.4 Forced reveal cleanup
After final-turn completion:
- any remaining face-down cards are automatically revealed

---

## 10. Scoring

### 10.1 Timing
- Scoring occurs only after the round ends and all cards are revealed

### 10.2 Default card values
- A = 1
- 2 = -2
- 3–10 = face value
- J = 10
- Q = 10
- K = 0

### 10.3 Custom mappings
- Custom card-value mappings are allowed at table creation

### 10.4 Mode support
- Holes mode: exactly 9 rounds
- Points mode: supported, but treated as beta

### 10.5 Validator rule
- If `endConditions.mode == "holes"`, then `maxRounds` must be 9

### 10.6 Ties
- Ties are allowed
- Multiple winners are possible

---

## 11. Draw Pile Exhaustion

Implemented behavior:
1. Keep the top discard card in place
2. Shuffle the remaining discard pile back into the shoe when the shoe empties

---

## 12. Chat

- Chat exists only while at least one participant is connected
- Chat is stored only in Durable Object memory
- Chat is destroyed when the table empties
- Muting is owner-controlled and server-enforced
- Muted users receive a small UI notice rather than a giant blocking error

---

## 13. UI Requirements

### 13.1 Current implemented UI
- Title: **Golf - The Card Game**
- Home screen includes table setup and Create Table
- Create Table auto-connects on success
- Lobby supports:
  - display names for players and spectators
  - owner controls
  - invite links after table creation
- Game view supports:
  - public table view
  - help/rules panel
  - confirmation modal
  - owner controls
  - chat
  - timers and game-status display

### 13.2 Planned enhancement
- PixiJS may later replace HTML rendering for visual polish and animation
- Any future rendering layer must remain state-driven and preserve the no-private-peeks rule

---

## 14. Deployment Model

### 14.1 Current deployment
- Worker serves built UI assets from `apps/web/dist`
- API routes are served under `/api/*`
- WebSocket routes are served under `/ws/*`

### 14.2 CI/CD shape
Current deployment workflow:
- Build command: `cd apps/web && npm ci && npm run build`
- Deploy command: `cd worker && npx wrangler deploy --config wrangler.jsonc`

### 14.3 Production URL
- `https://cardgolf.unopenedparachute.workers.dev`

---

## 15. Known Issues / Active Risks

### 15.1 Production create-table failure
A known production issue has existed where Create Table returned HTTP 500 / Worker exception.
Likely cause:
- missing authenticated email in production causing an unhandled null/invalid identity path

Expected hardened behavior:
- return a clean JSON `401 Unauthorized` when identity is missing
- do not throw an unhandled exception

### 15.2 Access hardening
Production should be protected with Cloudflare Access / Google identity across the relevant app paths.

### 15.3 Privacy polish
Visible email usage in the UI should continue to be reduced in favor of display names.

### 15.4 Backend modularity
`worker/src/table_do.ts` is large and is a candidate for future modularization after stabilization.

---

## 16. Out of Scope

Currently out of scope:
- persistent match resume after table destruction
- bots
- client-side hidden-information shortcuts that bypass server authority
- non-Cloudflare production targets
- long-term stats/history systems beyond current table/hygiene usage

---

## 17. Project File Map (App-Owned Files)

This file map intentionally excludes:
- `node_modules`
- `.git`
- installed/vendor files
- generic tool internals

It includes the app-owned files that define CardGolf’s shipped behavior, UI, routing, rules, and schema.

### 17.1 Frontend shell and config
- `apps/web/index.html` — Vite app entry HTML
- `apps/web/vite.config.ts` — Vite config and dev proxy behavior
- `apps/web/package.json` — frontend package manifest

### 17.2 Frontend source
- `apps/web/src/main.tsx` — React entry point
- `apps/web/src/App.tsx` — main application shell and screen/state flow
- `apps/web/src/App.css` — app-level styling
- `apps/web/src/index.css` — base/global styling

### 17.3 Frontend client/types
- `apps/web/src/lib/cgClient.ts` — same-origin HTTP/WS client; localhost dev email behavior
- `apps/web/src/lib/cgTypes.ts` — frontend shared type definitions

### 17.4 Frontend UI components
- `apps/web/src/ui/CardValuesPanel.tsx` — card-values editor/display panel
- `apps/web/src/ui/ChatPanel.tsx` — live chat panel
- `apps/web/src/ui/ConfirmModal.tsx` — custom confirmation modal
- `apps/web/src/ui/GameStatusBar.tsx` — game/turn/status display
- `apps/web/src/ui/HelpCard.tsx` — rules/help panel
- `apps/web/src/ui/OwnerControlsPanel.tsx` — owner moderation controls
- `apps/web/src/ui/PilesPanel.tsx` — draw/discard pile UI
- `apps/web/src/ui/PlayerGridSmall.tsx` — compact player grid view
- `apps/web/src/ui/PlayersPanel.tsx` — players/spectators panel
- `apps/web/src/ui/TableSetupPanel.tsx` — table/rules setup UI
- `apps/web/src/ui/TableViewPanel.tsx` — shared/public table state panel
- `apps/web/src/ui/TurnControls.tsx` — player turn actions UI
- `apps/web/src/ui/YouGrid.tsx` — current-player grid UI

### 17.5 Backend source
- `worker/src/index.ts` — Worker router; API/WS entry; table creation and request handling
- `worker/src/protocol.ts` — wire message types and payload contracts
- `worker/src/golf_deck.ts` — deck/discard reshuffle helper
- `worker/src/golf_turn.ts` — turn/roster helper logic
- `worker/src/table_gc.ts` — D1 hygiene and stale-table purge logic
- `worker/src/table_do.ts` — Durable Object authoritative game engine and websocket coordination
- `worker/src/validate_rules.ts` — server-side rules validation

### 17.6 Database
- `db/migrations/0001_init.sql` — initial schema migration
- `db/migrations/0002_tables.sql` — table-related schema migration
- `db/migrations/0003_tables_hardening.sql` — schema hardening migration

### 17.7 Documentation
- `docs/Specifications.md` — prior living specification/history document
- `docs/rules.json.md` — rules/config reference and notes
- `docs/CardGolf Specification.md` — formal product specification for current deployment
- `docs/CardGolf Deployment Instructions.md` — deployment and maintenance guide

---

## 18. Source of Truth

For ongoing development:
- GitHub repository is the source of truth for code and docs
- production deployment should reflect the current `main` branch state
- documentation should be updated when routes, auth, schema, or core rules change