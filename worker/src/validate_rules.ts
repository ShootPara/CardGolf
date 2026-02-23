/**
 * FILE: /worker/src/validate_rules.ts (NEW)
 *
 * Minimal, strict-ish validation for rules_json v1.0.
 * This is not a full JSON Schema validator; it just prevents nonsense.
 */

export type RulesJsonV1 = {
  schemaVersion: 1;
  rulesetName: string;
  gameVariant: {
    variantId: "golf-6card";
    grid: { rows: 2; cols: 3 };
    initialPeekCount: number;
    deckCount: 2;
  };
  endConditions: {
    mode: "holes" | "points";
    maxRounds: number | null;
    pointsTarget: number | null;
    roundEnd: {
      trigger: "player_reveals_last_card";
      finalTurnPolicy: "everyone_gets_one_more_turn";
      autoRevealRemainingFaceDown: true;
      passAllowedDuringFinalTurn: false;
    };
  };
  scoring: {
    rankValues: Record<string, number>;
    columnMatchCancels: true;
  };
  passRule: {
    enabled: true;
    requiresDrawFirst: true;
    requiresExactlyOneFaceDown: true;
    disabledDuringFinalTurn: true;
  };
  uiOptions: {
    allowSpectators: true;
    allowSpectatorChat: boolean;
  };
};

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export function validateRulesJson(input: any): { ok: true; value: RulesJsonV1 } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "rules_json must be an object" };
  if (input.schemaVersion !== 1) return { ok: false, error: "schemaVersion must be 1" };

  // Fixed variant constraints
  if (!input.gameVariant || input.gameVariant.variantId !== "golf-6card") return { ok: false, error: "variantId must be golf-6card" };
  if (input.gameVariant?.deckCount !== 2) return { ok: false, error: "deckCount must be 2 (fixed)" };
  if (input.gameVariant?.grid?.rows !== 2 || input.gameVariant?.grid?.cols !== 3) return { ok: false, error: "grid must be 2x3" };

  // End conditions constraints
  const mode = input.endConditions?.mode;
  if (mode !== "holes" && mode !== "points") return { ok: false, error: "endConditions.mode must be holes or points" };
  if (mode === "holes" && input.endConditions?.maxRounds !== 9) return { ok: false, error: "holes mode requires maxRounds = 9" };
  if (mode === "points") {
    const pt = input.endConditions?.pointsTarget;
    if (typeof pt !== "number" || !Number.isFinite(pt) || pt <= 0) return { ok: false, error: "points mode requires a positive pointsTarget" };
  }

  // Locked round-end policies
  const re = input.endConditions?.roundEnd;
  if (!re) return { ok: false, error: "endConditions.roundEnd missing" };
  if (re.trigger !== "player_reveals_last_card") return { ok: false, error: "roundEnd.trigger must be player_reveals_last_card" };
  if (re.finalTurnPolicy !== "everyone_gets_one_more_turn") return { ok: false, error: "roundEnd.finalTurnPolicy must be everyone_gets_one_more_turn" };
  if (re.autoRevealRemainingFaceDown !== true) return { ok: false, error: "roundEnd.autoRevealRemainingFaceDown must be true" };
  if (re.passAllowedDuringFinalTurn !== false) return { ok: false, error: "roundEnd.passAllowedDuringFinalTurn must be false" };

  // Locked scoring policy
  if (input.scoring?.columnMatchCancels !== true) return { ok: false, error: "columnMatchCancels must be true" };

  // Rank values
  const rv = input.scoring?.rankValues;
  if (!rv || typeof rv !== "object") return { ok: false, error: "scoring.rankValues missing" };
  for (const r of RANKS) {
    if (typeof rv[r] !== "number" || !Number.isFinite(rv[r])) return { ok: false, error: `rankValues.${r} must be a number` };
  }

  // Pass rule (locked)
  const pr = input.passRule;
  if (!pr || pr.enabled !== true || pr.requiresDrawFirst !== true || pr.requiresExactlyOneFaceDown !== true || pr.disabledDuringFinalTurn !== true) {
    return { ok: false, error: "passRule must match locked configuration" };
  }

  // UI
  const uo = input.uiOptions;
  if (!uo || uo.allowSpectators !== true) return { ok: false, error: "uiOptions.allowSpectators must be true" };
  if (typeof uo.allowSpectatorChat !== "boolean") return { ok: false, error: "uiOptions.allowSpectatorChat must be boolean" };

  return { ok: true, value: input as RulesJsonV1 };
}
