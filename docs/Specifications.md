# Golf (Card Game) — Multiplayer Web App Specification
Version: 1.0 (Locked)
Status: Implementation-Ready
Stack: Cloudflare Workers + Durable Objects + D1 + React + PixiJS
Auth: Cloudflare Zero Trust (Google OAuth)

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
- Initial peek count: 2
- Deck count: 2 (fixed, not configurable)

## 4.2 Column Rule
- If two cards in the same column match, that column scores 0 points
- Always enabled
- Match applies only at scoring (end of round)
- Player may break a match during play

---

# 5. Turn Flow

## 5.1 Start of Turn

Player may:
- Click draw pile
- Click discard pile
- Reveal a face-down card immediately

---

## 5.2 After Drawing

The drawn card is revealed to everyone.

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
- Drawn card replaces it

### If discarding drawn card:
- Player must reveal one face-down card
- That revealed card stays in place

---

## 5.3 Reveal Without Drawing

Player may reveal a face-down card without drawing.
Turn ends immediately.

If that was their last face-down card:
- Game ends
- Final turn phase begins

---

## 5.4 Pass Rule

Pass is allowed ONLY if:

- Game is not in final-turn phase
- Player has exactly one face-down card remaining
- Player drew and discarded during the turn
- Player did not reveal a card this turn

Pass:
- Ends turn
- Does not reveal final card
- Does not end the game

Pass is NOT allowed during final-turn phase.

---

# 6. End of Game

Game ends when:
- A player intentionally reveals their last face-down card.

Then:
- All other players get exactly one final turn.
- During final-turn phase:
  - Pass is disabled.
  - At end of each player’s final turn, all remaining face-down cards automatically flip face-up.

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

## 7.3 Points Mode
- Target default: 100
- When a player reaches/exceeds target:
  - Finish round
  - Lowest cumulative score wins

## 7.4 Ties
- Ties allowed
- Multiple winners possible

---

# 8. Draw Pile Exhaustion

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

Start of turn:
> Click the draw pile or discard pile to take a card, or reveal a card in your hand to end your turn immediately.

After drawing:
> Click a card in your grid to swap, or click the discard pile to discard the drawn card.

Last card:
> You may reveal your last card to end the game, or click Pass to continue playing.

Final turn:
> Final turn: reveal or swap cards. All remaining face-down cards will flip after your turn.

## 11.3 Confirmation Modal

When revealing final card:
> “Revealing your last card ends the game for everyone. Do you wish to continue?”

---

# 12. Persistence (D1)

## players
- player_id
- email
- display_name
- last_table_rules_json
- wins_total
- losses_total
- created_at

## games
- game_id
- created_at
- ended_at
- duration_seconds
- mode
- target_points
- rules_json
- creator_player_id

## game_players
- game_id
- player_id
- final_score
- is_winner

## player_monthly_stats
- player_id
- year_month
- games_played
- wins
- losses
- lowest_score
- highest_score

## global_stats
- total_games
- longest_game_seconds
- longest_game_id
- highest_games_in_one_day
- highest_games_in_one_day_date

Stats written only at valid game completion.

---

# 13. Definition of Done

All gameplay deterministic.
No open decisions.
No configurable deck count.
No passing during final turn.
No spectator-to-player transitions after start.
