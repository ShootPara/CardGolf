{
  "schemaVersion": 1,
  "rulesetName": "App Default",
  "gameVariant": {
    "variantId": "golf-6card",
    "grid": { "rows": 2, "cols": 3 },

    // NOTE: Despite the name, current implementation treats this as:
    // "initial reveal count" (global face-up flips), NOT private peeks.
    "initialPeekCount": 2,

    // Spec says deck count is fixed at 2. Keep this value at 2.
    "deckCount": 2
  },
  "endConditions": {
    "mode": "holes",

    // NOTE: Current validate_rules enforces holes mode requires maxRounds = 9.
    "maxRounds": 9,

    "pointsTarget": null,
    "roundEnd": {
      "trigger": "player_reveals_last_card",
      "finalTurnPolicy": "everyone_gets_one_more_turn",
      "autoRevealRemainingFaceDown": true,
      "passAllowedDuringFinalTurn": false
    }
  },
  "scoring": {
    "rankValues": {
      "A": 1,
      "2": -2,
      "3": 3,
      "4": 4,
      "5": 5,
      "6": 6,
      "7": 7,
      "8": 8,
      "9": 9,
      "10": 10,
      "J": 10,
      "Q": 10,
      "K": 0
    },
    "columnMatchCancels": true
  },
  "passRule": {
    "enabled": true,
    "requiresDrawFirst": true,
    "requiresExactlyOneFaceDown": true,
    "disabledDuringFinalTurn": true
  },
  "uiOptions": {
    "allowSpectators": true,
    "allowSpectatorChat": true
  }

  // Implementation note (not a rules flag):
  // Backend seeds discardTop with 1 face-up card at start of game and each new round.
}