// FILE: /apps/web/src/ui/PlayerGridSmall.tsx (NEW)
//
// Small 2x3 grid renderer used for other players (and optionally you).
// No private peeks: relies on server to omit face-down card faces.

import type { GridPos } from "../lib/cgTypes";

const TOP_ROW: GridPos[] = [1, 3, 5];
const BOT_ROW: GridPos[] = [2, 4, 6];

function cardLabel(card: any): string {
  if (!card) return "";
  const r = card.rank ?? card.r ?? card.value ?? "";
  const s = card.suit ?? card.s ?? "";
  return `${r}${s}`;
}

type PlayerGridSmallProps = {
  grid: any[] | null | undefined; // array of {pos, visible/revealed, card?}
};

export function PlayerGridSmall({ grid }: PlayerGridSmallProps) {
  const gridArr: any[] = Array.isArray(grid) ? grid : [];

  function getCell(pos: GridPos) {
    return gridArr.find((c) => c?.pos === pos) ?? null;
  }

  function tileText(pos: GridPos) {
    const cell = getCell(pos);
    const visible = !!(cell?.visible ?? cell?.revealed);
    if (!visible) return "🂠";
    const label = cardLabel(cell?.card);
    return label ? label : "🂡";
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {[TOP_ROW, BOT_ROW].map((row, idx) => (
        <div
          key={idx}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
          }}
        >
          {row.map((pos) => (
            <div
              key={pos}
              style={{
                height: 44,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "#101010",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                fontSize: 14,
                opacity: 0.95,
              }}
              title={`pos ${pos}`}
            >
              {tileText(pos)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
