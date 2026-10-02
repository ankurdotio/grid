import { useSelector } from "react-redux";

export default function TopBar() {
  const user = useSelector((state) => state.user.user);
  const status = useSelector((state) => state.game.connectionStatus);
  const online = useSelector((state) => state.game.online);
  const owned = useSelector((state) => Object.values(state.game.cells)
    .filter((cell) => cell.ownerId === state.user.user?.id).length);

  return (
    <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
      <div>
        <h1 className="text-xl font-semibold">Shared Grid</h1>
        <p className="text-sm text-zinc-400">Playing as <span style={{ color: user?.color }}>{user?.name}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${status === "connected" ? "bg-emerald-400" : "bg-amber-400"}`} />
          {status}
        </span>
        <span>{online} online</span>
        <span>{owned} {owned === 1 ? "cell" : "cells"}</span>
      </div>
    </header>
  );
}
