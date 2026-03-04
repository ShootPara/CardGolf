// FILE: /apps/web/src/ui/CardValuesPanel.tsx (REPLACE)
//
// Change:
// - Compact, collapsible display (meant to sit under Chat)
// - Much smaller tiles / typography

type CardValuesPanelProps = {
  gameState: any;
};

const ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export function CardValuesPanel({ gameState }: CardValuesPanelProps) {
  const rv = gameState?.rulesSummary?.rankValues ?? null;
  if (!rv) return null;

  return (
    <details
      style={{
        borderRadius: 12,
        padding: 10,
        background: "#141414",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 800 }}>Card Values</span>
        <span style={{ opacity: 0.7, fontSize: 12 }}>points per rank</span>
      </summary>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
        {ORDER.map((r) => (
          <div
            key={r}
            style={{
              borderRadius: 10,
              padding: "6px 6px",
              background: "#101010",
              border: "1px solid rgba(255,255,255,0.08)",
              display: "grid",
              gap: 2,
              textAlign: "center",
              minHeight: 44,
            }}
            title={`${r} = ${String(rv[r])}`}
          >
            <div style={{ fontWeight: 900, fontSize: 12, lineHeight: "12px" }}>{r}</div>
            <div style={{ opacity: 0.92, fontWeight: 800, fontSize: 12, lineHeight: "12px" }}>{String(rv[r])}</div>
          </div>
        ))}
      </div>

      <div style={{ opacity: 0.6, fontSize: 11, marginTop: 8 }}>
        Column match cancels to 0 when both ranks match.
      </div>
    </details>
  );
}