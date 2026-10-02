import { useRef, useState } from "react";
import { useSelector } from "react-redux";
import Cell from "./Cell.jsx";
import { sendClaim } from "../socket.js";

export default function Grid() {
  const gridSize = useSelector((state) => state.game.gridSize);
  const cells = useSelector((state) => state.game.cells);
  const connected = useSelector((state) => state.game.connectionStatus === "connected");
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  function startDrag(event) {
    if (event.button !== 0) return;
    const cellButton = event.target.closest("[data-cell-id]");
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      cellId: cellButton ? Number(cellButton.dataset.cellId) : null,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.hypot(dx, dy) > 5) drag.current.moved = true;
    if (drag.current.moved) setPan({ x: drag.current.panX + dx, y: drag.current.panY + dy });
  }

  function endDrag() {
    if (!drag.current) return;
    if (!drag.current.moved && drag.current.cellId !== null) claim(drag.current.cellId);
    drag.current = null;
  }

  function claim(cellId) {
    if (!connected) return;
    sendClaim(cellId);
  }

  return (
    <section className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">The board</h2>
          <p className="text-xs text-zinc-500">Click an open cell to capture it. Drag to pan.</p>
        </div>
        <div className="flex gap-2">
          <button aria-label="Zoom out" onClick={() => setScale((value) => Math.max(0.5, value - 0.1))}
            className="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-800">−</button>
          <button aria-label="Zoom in" onClick={() => setScale((value) => Math.min(2, value + 0.1))}
            className="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-800">+</button>
        </div>
      </div>
      <div
        className="h-[min(68vh,680px)] overflow-hidden rounded-xl bg-zinc-950 p-4"
        onWheel={(event) => {
          event.preventDefault();
          setScale((value) => Math.min(2, Math.max(0.5, value - event.deltaY * 0.001)));
        }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ touchAction: "none" }}
      >
        <div
          className="mx-auto grid w-fit origin-center select-none"
          style={{
            gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          }}
        >
          {Array.from({ length: gridSize * gridSize }, (_, cellId) => (
            <Cell key={cellId} cellId={cellId} onClaim={claim} />
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        {Object.keys(cells).length} captured {Object.keys(cells).length === 1 ? "cell" : "cells"}
      </p>
    </section>
  );
}
