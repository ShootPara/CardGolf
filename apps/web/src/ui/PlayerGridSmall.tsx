// FILE: /apps/web/src/ui/PlayerGridSmall.tsx (REPLACE)
//
// Change:
// - Suit letters -> symbols
// - Red suits (♥ ♦) colored

import type { GridPos } from "../lib/cgTypes";

const TOP_ROW: GridPos[] = [1, 3, 5];
const BOT_ROW: GridPos[] = [2, 4, 6];

function suitSymbol(s: any): string {
  const v = String(s ?? "");
  if (v === "C") return "♣";
  if (v === "D") return "♦";
  if (v === "H") return "♥";
  if (v === "S") return "♠";
  return v;
}

function suitColor(symbol: string): string {
  return symbol === "♥" || symbol === "♦" ? "#ff4d4d" : "white";
}

function renderCard(card: any) {
  if (!card) return null;
  const r = card.rank ?? card.r ?? card.value ?? "";
  const sym = suitSymbol(card.suit ?? card.s ?? "");
  return (
    <span style={{ fontWeight: 900, fontSize: 13 }}>
      <span>{String(r)}</span>
      <span style={{ color: suitColor(sym) }}>{sym}</span>
    </span>
  );
}

type PlayerGridSmallProps = {
  grid: any[] | null | undefined;
};

export function PlayerGridSmall({ grid }: PlayerGridSmallProps) {
  const gridArr: any[] = Array.isArray(grid) ? grid : [];

  function getCell(pos: GridPos) {
    return gridArr.find((c) => c?.pos === pos) ?? null;
  }

  function tileBody(pos: GridPos) {
    const cell = getCell(pos);
    const visible = !!(cell?.visible ?? cell?.revealed);
    if (!visible) return <span>🂠</span>;
    const node = renderCard(cell?.card);
    return node ? node : <span>🂡</span>;
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {[TOP_ROW, BOT_ROW].map((row, idx) => (
        <div key={idx} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
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
              {tileBody(pos)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}