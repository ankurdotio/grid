import { memo } from "react";
import { useSelector } from "react-redux";

function Cell({ cellId, onClaim }) {
  const cell = useSelector((state) => state.game.cells[cellId]);
  const pending = useSelector((state) => Boolean(state.game.pending[cellId]));
  const effect = useSelector((state) => state.game.effects[cellId]);
  const clockOffset = useSelector((state) => state.game.clockOffset);
  const userId = useSelector((state) => state.user.user?.id);
  const now = Date.now() + clockOffset;
  const remaining = cell ? Math.max(0, cell.lockedUntil - now) : 0;
  const locked = remaining > 0;
  const classes = [
    "relative aspect-square min-h-0 min-w-0 border border-zinc-950",
    !cell && "bg-zinc-800 hover:bg-zinc-700",
    pending && "pending-pulse",
    effect === "pop" && "capture-pop",
    effect === "shake" && "reject-shake",
    cell?.ownerId === userId && "z-10 outline outline-1 outline-white",
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      data-cell-id={cellId}
      aria-label={cell ? `Cell ${cellId}, owned by ${cell.ownerName}` : `Unclaimed cell ${cellId}`}
      title={cell ? `Cell ${cellId} · ${cell.ownerName}${locked ? " · locked" : ""}` : `Cell ${cellId} · unclaimed`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClaim(cellId);
        }
      }}
      className={classes}
      style={{ width: "min(1.7vw, 16px)", backgroundColor: cell?.color }}
    >
      {locked && (
        <span
          aria-hidden="true"
          className="lock-countdown absolute inset-x-0 bottom-0 h-[2px] bg-white/90"
          style={{ animationDuration: `${remaining}ms` }}
        />
      )}
    </button>
  );
}

export default memo(Cell);
