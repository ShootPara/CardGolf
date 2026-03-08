/**
 * FILE: /apps/web/src/ui/TableSetupPanel.tsx (NEW)
 *
 * Table Setup UI:
 * - holes vs points
 * - pointsTarget (points mode)
 * - initial reveal count (aka initialPeekCount, treated as initial reveals)
 * - spectator chat toggle
 * - rankValues editor
 */

import { useMemo, useState } from "react";

type EndMode = "holes" | "points";
type RankKey = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

const RANKS: RankKey[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export type RulesJsonV1 = {
  schemaVersion: 1;
  rulesetName: string;
  gameVariant: {
    variantId: "golf-6card";
    grid: { rows: 2; cols: 3 };
    initialPeekCount: number; // treated as "initial reveal count" (NO private peeks)
    deckCount: 2;
  };
  endConditions: {
    mode: EndMode;
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
    rankValues: Record<RankKey, number>;
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

export type TableSetupState = {
  rulesetName: string;
  mode: EndMode;

  // holes mode constraint: maxRounds must be 9 (validator-enforced)
  // points mode constraint: pointsTarget must be positive
  pointsTarget: string; // keep as string for UI typing

  initialRevealCount: string; // keep as string for UI typing (maps to initialPeekCount)
  allowSpectatorChat: boolean;

  rankValues: Record<RankKey, string>; // keep as strings for UI typing
};

function defaultRankValues(): Record<RankKey, string> {
  return {
    A: "1",
    "2": "-2",
    "3": "3",
    "4": "4",
    "5": "5",
    "6": "6",
    "7": "7",
    "8": "8",
    "9": "9",
    "10": "10",
    J: "10",
    Q: "10",
    K: "0",
  };
}

export function defaultTableSetupState(): TableSetupState {
  return {
    rulesetName: "UI Default",
    mode: "holes",
    pointsTarget: "100",
    initialRevealCount: "2",
    allowSpectatorChat: true,
    rankValues: defaultRankValues(),
  };
}

function parseFiniteInt(s: string): number | null {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (String(i) !== String(n) && String(n) !== s.trim()) {
    // tolerate "2.0" etc, but the trunc is what matters
  }
  return i;
}

function parseFiniteNumber(s: string): number | null {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Build rules_json and return any UI validation error string.
 * This mirrors backend validation constraints:
 * - holes => maxRounds must be 9
 * - points => pointsTarget must be positive
 * - rankValues must be numbers for all ranks
 */
export function buildRulesJsonFromSetup(setup: TableSetupState): { ok: true; rules: RulesJsonV1 } | { ok: false; error: string } {
  const initial = parseFiniteInt(setup.initialRevealCount);
  if (initial == null || initial < 0) return { ok: false, error: "Initial reveal count must be a whole number ≥ 0." };

  let pointsTarget: number | null = null;
  let maxRounds: number | null = null;

  if (setup.mode === "holes") {
    maxRounds = 9; // enforced by validator
    pointsTarget = null;
  } else {
    maxRounds = null;
    const pt = parseFiniteInt(setup.pointsTarget);
    if (pt == null || pt <= 0) return { ok: false, error: "Points target must be a positive whole number." };
    pointsTarget = pt;
  }

  const rv: any = {};
  for (const r of RANKS) {
    const n = parseFiniteNumber(setup.rankValues[r]);
    if (n == null) return { ok: false, error: "Rank value for " + r + " must be a valid number." };
    rv[r] = n;
  }

  const rules: RulesJsonV1 = {
    schemaVersion: 1,
    rulesetName: setup.rulesetName || "UI Rules",
    gameVariant: {
      variantId: "golf-6card",
      grid: { rows: 2, cols: 3 },
      initialPeekCount: initial,
      deckCount: 2,
    },
    endConditions: {
      mode: setup.mode,
      maxRounds,
      pointsTarget,
      roundEnd: {
        trigger: "player_reveals_last_card",
        finalTurnPolicy: "everyone_gets_one_more_turn",
        autoRevealRemainingFaceDown: true,
        passAllowedDuringFinalTurn: false,
      },
    },
    scoring: {
      rankValues: rv,
      columnMatchCancels: true,
    },
    passRule: {
      enabled: true,
      requiresDrawFirst: true,
      requiresExactlyOneFaceDown: true,
      disabledDuringFinalTurn: true,
    },
    uiOptions: {
      allowSpectators: true, // locked true per validate_rules.ts
      allowSpectatorChat: setup.allowSpectatorChat,
    },
  };

  return { ok: true, rules };
}

export function TableSetupPanel(props: {
  value: TableSetupState;
  onChange: (next: TableSetupState) => void;
  showDebug?: boolean;
}) {
  const { value, onChange, showDebug } = props;
  const dbg = (showDebug ?? new URLSearchParams(window.location.search).get("debug") === "1");

  const preview = useMemo(() => {
    const built = buildRulesJsonFromSetup(value);
    if (!built.ok) return { ok: false as const, error: built.error, json: null as any };
    return { ok: true as const, error: null as any, json: built.rules };
  }, [value]);

  return (
    <div style={{ background: "#111", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>Table Setup</div>
        <button
          onClick={() => onChange(defaultTableSetupState())}
          title="Reset table setup back to defaults"
          style={{ opacity: 0.9 }}
        >
          Reset Defaults
        </button>
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            rulesetName:&nbsp;
            <input
              value={value.rulesetName}
              onChange={(e) => onChange({ ...value, rulesetName: e.target.value })}
              style={{ width: 220 }}
            />
          </label>

          <label>
            mode:&nbsp;
            <select
              value={value.mode}
              onChange={(e) => onChange({ ...value, mode: e.target.value as EndMode })}
            >
              <option value="holes">holes (9 rounds)</option>
              <option value="points">points (target)</option>
            </select>
          </label>

          {value.mode === "holes" ? (
            <div style={{ opacity: 0.85 }}>
              maxRounds: <strong>9</strong> (validator-enforced)
            </div>
          ) : (
            <label>
              pointsTarget:&nbsp;
              <input
                value={value.pointsTarget}
                onChange={(e) => onChange({ ...value, pointsTarget: e.target.value })}
                style={{ width: 90 }}
              />
            </label>
          )}

          <label title="This is stored in rules_json as gameVariant.initialPeekCount, but gameplay is NO private peeks — it's initial reveals.">
            initialRevealCount:&nbsp;
            <input
              value={value.initialRevealCount}
              onChange={(e) => onChange({ ...value, initialRevealCount: e.target.value })}
              style={{ width: 60 }}
            />
          </label>

          <label>
            spectatorChat:&nbsp;
            <input
              type="checkbox"
              checked={value.allowSpectatorChat}
              onChange={(e) => onChange({ ...value, allowSpectatorChat: e.target.checked })}
            />
          </label>
        </div>

        <details open>
                           <summary style={{ cursor: "pointer", opacity: 0.9 }}>Card point values (rankValues)</summary>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}>
            {RANKS.map((r) => (
              <label key={r} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 20, display: "inline-block", opacity: 0.9 }}>{r}</span>
                <input
                  value={value.rankValues[r]}
                  onChange={(e) => onChange({ ...value, rankValues: { ...value.rankValues, [r]: e.target.value } })}
                  style={{ width: 64 }}
                />
              </label>
            ))}
          </div>
        </details>

        {!preview.ok ? (
          <div style={{ background: "#331111", padding: 10, borderRadius: 10 }}>
            <strong>Setup error:</strong> {preview.error}
          </div>
        ) : (
          dbg ? (
            <details>
            <summary style={{ cursor: "pointer", opacity: 0.9 }}>rules_json preview (debug)</summary>
            <pre style={{ background: "#0c0c0c", padding: 10, borderRadius: 10, overflowX: "auto", marginTop: 8 }}>
              {JSON.stringify(preview.json, null, 2)}
            </pre>
          </details>
          ) : null
        )}
      </div>
    </div>
  );
}