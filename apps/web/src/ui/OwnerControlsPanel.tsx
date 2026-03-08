// FILE: /apps/web/src/ui/OwnerControlsPanel.tsx (NEW)
//
// Owner-only admin controls:
// - Delegate ownership
// - Mute/unmute players/spectators
// - Kick players/spectators
//
// Uses wsSend passed in from App.

type OwnerControlsPanelProps = {
  tableState: any;
  myPlayerId: string | null;
  wsStatus: string;
  wsSend: (type: string, payload?: any) => void;
};

export function OwnerControlsPanel({ tableState, myPlayerId, wsStatus, wsSend }: OwnerControlsPanelProps) {
  const isConnected = wsStatus === "connected";
  const ownerPlayerId = tableState?.ownerPlayerId ?? null;
  const isOwner = !!myPlayerId && myPlayerId === ownerPlayerId;

  const players: any[] = Array.isArray(tableState?.players) ? tableState.players : [];
  const spectators: any[] = Array.isArray(tableState?.spectators) ? tableState.spectators : [];

  const mutedPlayers: string[] = Array.isArray(tableState?.mutedPlayers) ? tableState.mutedPlayers : [];
  const mutedSpectators: string[] = Array.isArray(tableState?.mutedSpectators) ? tableState.mutedSpectators : [];

  if (!isOwner) return null;

  function isMuted(role: "player" | "spectator", id: string): boolean {
    return role === "player" ? mutedPlayers.includes(id) : mutedSpectators.includes(id);
  }

  function mute(role: "player" | "spectator", id: string) {
    wsSend("MUTE", { targetId: id, targetRole: role });
  }

  function unmute(role: "player" | "spectator", id: string) {
    wsSend("UNMUTE", { targetId: id, targetRole: role });
  }

  function kick(role: "player" | "spectator", id: string) {
    wsSend("KICK", { targetId: id, targetRole: role });
  }

  function delegate(toPlayerId: string) {
    wsSend("OWNER_DELEGATE", { newOwnerPlayerId: toPlayerId, toPlayerId });
  }

  return (
    <div
      style={{
        borderRadius: 12,
        padding: 12,
        background: "#141414",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontWeight: 900 }}>Owner Controls</div>
        <div style={{ opacity: 0.7, fontSize: 12 }}>delegate • mute • kick</div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ opacity: 0.8, fontSize: 12 }}>
          Owner: <strong>{(players.find((p) => p?.playerId === ownerPlayerId)?.displayName ?? players.find((p) => p?.playerId === ownerPlayerId)?.email ?? ownerPlayerId ?? "—")}</strong>
        </div>

        {/* Players */}
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 800, opacity: 0.9 }}>Players</div>

          {players.map((p) => {
            const pid = p?.playerId;
            const label = (p?.displayName ?? p?.email ?? pid) as string;
            const muted = pid ? isMuted("player", pid) : false;
            const canDelegate = pid && pid !== ownerPlayerId;

            return (
              <div
                key={pid}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 10,
                  alignItems: "center",
                  padding: 10,
                  borderRadius: 10,
                  background: "#101010",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>{label}</div>
                  {pid === ownerPlayerId ? <div style={{ opacity: 0.65, fontSize: 12 }}>owner</div> : null}
                  {muted ? <div style={{ opacity: 0.75, fontSize: 12 }}>muted</div> : null}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {pid ? (
                    muted ? (
                      <button disabled={!isConnected} onClick={() => unmute("player", pid)}>
                        Unmute
                      </button>
                    ) : (
                      <button disabled={!isConnected} onClick={() => mute("player", pid)}>
                        Mute
                      </button>
                    )
                  ) : null}

                  {pid ? (
                    <button disabled={!isConnected || pid === ownerPlayerId} onClick={() => kick("player", pid)}>
                      Kick
                    </button>
                  ) : null}

                  {pid && canDelegate ? (
                    <button disabled={!isConnected} onClick={() => delegate(pid)}>
                      Delegate
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Spectators */}
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 800, opacity: 0.9 }}>Spectators</div>

          {spectators.length === 0 ? (
            <div style={{ opacity: 0.7, fontSize: 12 }}>(none)</div>
          ) : (
            spectators.map((s) => {
              const sid = s?.spectatorId;
              const label = (s?.displayName ?? s?.email ?? sid) as string;
              const muted = sid ? isMuted("spectator", sid) : false;

              return (
                <div
                  key={sid}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 10,
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 10,
                    background: "#101010",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>{label}</div>
                    {muted ? <div style={{ opacity: 0.75, fontSize: 12 }}>muted</div> : null}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {sid ? (
                      muted ? (
                        <button disabled={!isConnected} onClick={() => unmute("spectator", sid)}>
                          Unmute
                        </button>
                      ) : (
                        <button disabled={!isConnected} onClick={() => mute("spectator", sid)}>
                          Mute
                        </button>
                      )
                    ) : null}

                    {sid ? (
                      <button disabled={!isConnected} onClick={() => kick("spectator", sid)}>
                        Kick
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ opacity: 0.6, fontSize: 11 }}>
        Notes: “Kick” disconnects the socket; they can rejoin if the table is still open (players cannot rejoin after start).
      </div>
    </div>
  );
}