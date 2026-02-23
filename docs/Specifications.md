# Golf (Card Game) — Multiplayer Web App Specification
Version: 1.0 (Locked)
Status: Implementation-Ready
Stack: Cloudflare Workers + Durable Objects + D1 + React + PixiJS
Auth: Cloudflare Zero Trust (Google OAuth)

---

# 0. Implementation Notes (Important)

This spec uses the term “initial peek count” from the rules JSON field name, but **gameplay is NO PRIVATE PEEKS**:
- Cards are face-down for everyone until revealed.
- “Initial peek count” is treated as **initial reveal count** (players must reveal that many cards at the start of the game / round).

Validator constraint currently enforced by backend:
- If `endConditions.mode == "holes"`, then `maxRounds` must be **9**.

---

# 1. Purpose

A browser-based multiplayer implementation of 6-card Golf using:
- Authoritative Durable Object per table
- Ephemeral in-memory match state
- Persistent stats in D1
- React (app shell) + PixiJS (table UI)

No active match persistence. If the table empties, it is destroyed.

---

# 2. Player Rules

## 2.1 Player Limits
- Minimum players to start: 2
- Maximum players: 6
- No bots

## 2.2 Spectators
- May join before game starts
- Cannot become players after game starts
- Default spectator chat: allowed
- Spectator chat permission set at table creation and immutable afterward

---

# 3. Table Owner

## 3.1 Powers
- Mute/unmute players
- Mute/unmute spectators
- Kick players
- Kick spectators
- Delegate ownership to another player

## 3.2 Restrictions
- Owner cannot kick themselves
- If owner leaves, ownership transfers to oldest remaining player (by join time)
- Owner has no gameplay advantages

---

# 4. Game Variant

## 4.1 Variant
- 6-card Golf (2x3 grid)
- **Initial reveal count: 2** (field name in rules JSON is `initialPeekCount`)
- Deck count: 2 (fixed, not configurable)

Grid layout / positions:
|1|3|5|
|2|4|6|

## 4.2 Column Rule
- If two cards in the same column match, that column scores 0 points
- Always enabled
- Match applies only at scoring (end of round)
- **Match means same RANK, not same point value** (e.g., J and Q are not a match even if both score 10)
- Player may break a match during play

---

# 5. Turn Flow

## 5.1 Start-of-Game / Start-of-Round
On a player’s first turn of a round:
- Player must reveal exactly 2 face-down cards (initial reveals) before they may draw.

## 5.2 Start of Turn (normal play)
Player may:
- Click draw pile
- Click discard pile
- Reveal a face-down card immediately

---

## 5.3 After Drawing

Player must:
- Click a card in their grid to swap
- Or click discard pile to discard drawn card

### Swapping Rules
If swapping with face-up card:
- Face-up card goes to discard
- Drawn card replaces it face-up

If swapping with face-down card:
- Face-down card is revealed
- That revealed card goes to discard
- Drawn card replaces it face-up

### If discarding drawn card:
- Player must reveal one face-down card
- That revealed card stays in place

---

## 5.4 Reveal Without Drawing
Player may reveal a face-down card without drawing.
Turn ends immediately.

If that was their last face-down card:
- Round end trigger occurs
- Final turn phase begins

---

## 5.5 Pass Rule
Pass is allowed ONLY if:
- Game is not in final-turn phase
- Player has exactly one face-down card remaining
- Player drew during the turn and is discarding the drawn card
- Player did not reveal a card this turn

Pass:
- Ends turn
- Does not reveal final card
- Does not end the round

Pass is NOT allowed during final-turn phase.

---

# 6. End of Round / Final Turn Phase

Round end trigger:
- A player intentionally reveals their last face-down card.

Then:
- All other players get exactly one final turn.
- During final-turn phase:
  - Pass is disabled.
  - After the final-turn phase completes, all remaining face-down cards automatically flip face-up (if any remain).

---

# 7. Scoring

## 7.1 Timing
Scoring happens only at end of round after all cards are revealed.

## 7.2 Card Values (Default)
- A = 1
- 2 = -2
- 3–10 = face value
- J = 10
- Q = 10
- K = 0

Custom mappings allowed at table creation.

## 7.3 Mode Support
- Holes mode: play exactly 9 rounds (validator-enforced currently).
- Points mode (target-based) is planned but not implemented in current backend milestones.

## 7.4 Ties
- Ties allowed
- Multiple winners possible

---

# 8. Draw Pile Exhaustion (Planned)
If draw pile is empty:
1. Remove top card from discard pile
2. Shuffle remaining discard pile
3. That becomes new draw pile
4. Put removed card back as discard top

---

# 9. Leave / Kick Mid-Game
If a player leaves or is kicked:
- Removed from turn order
- Cards not revealed
- Cannot rejoin
- Game continues

If only one player remains:
- Game ends immediately
- Stats are NOT recorded

---

# 10. Chat
- Lives only while at least one player connected
- Stored in DO memory only
- Destroyed when table empty
- Owner may mute/unmute

---

# 11. UI Requirements

## 11.1 Required Assets
- Card sprite sheet (2 decks)
- Table background texture
- Hover glow effect

## 11.2 Help Card (Dynamic)
Start of round (first turn only):
> Reveal 2 cards in your grid to begin.

Start of turn:
> Click the draw pile or discard pile to take a card, or reveal a card in your grid to end your turn immediately.

After drawing:
> Click a card in your grid to swap, or click the discard pile to discard the drawn card (then reveal one face-down card).

Last card:
> You may reveal your last card to end the round, or click Pass (after drawing) to continue playing.

Final turn:
> Final turn: pass is disabled. Play your last turn normally.

## 11.3 Confirmation Modal (Planned)
When revealing final card:
> “Revealing your last card ends the round for everyone. Do you wish to continue?”

---

# 12. Persistence (D1)
(stats schema unchanged; implemented later)