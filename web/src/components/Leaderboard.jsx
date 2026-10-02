import { useSelector } from "react-redux";

export default function Leaderboard() {
  const top = useSelector((state) => state.game.leaderboard);
  const myId = useSelector((state) => state.user.user?.id);

  return (
    <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="font-medium">Leaderboard</h2>
      {top.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No captures yet.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {top.map((player, index) => (
            <li key={player.id}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${player.id === myId ? "bg-emerald-950 text-emerald-100" : "text-zinc-300"}`}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-5 text-zinc-500">{index + 1}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: player.color }} />
                <span className="truncate">{player.name}{player.id === myId ? " (you)" : ""}</span>
              </span>
              <span className="ml-2 tabular-nums">{player.count}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
