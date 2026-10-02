// Tests the sync rule from the spec: an update applies only if its version is
// newer than the cell's version, or the grid's baseVersion when it has none.
import { describe, expect, it } from "vitest";
import reducer, { cellUpdated, gridLoaded } from "./gameSlice.js";

const grid = {
  gridSize: 40,
  lockMs: 10_000,
  serverTime: Date.now(),
  version: 10,
  cells: [{ cellId: 5, ownerId: "ankur", color: "#ff0000", lockedUntil: 0 }],
  users: { ankur: { name: "Ankur", color: "#ff0000" } },
};

const update = (cellId, ownerId, version) => ({
  cellId,
  ownerId,
  ownerName: ownerId,
  color: "#00aaff",
  lockedUntil: Date.now() + 10_000,
  version,
});

const loaded = () => reducer(undefined, gridLoaded(grid));

describe("gameSlice sync rules", () => {
  it("loads the grid and remembers its version", () => {
    const state = loaded();
    expect(state.cells[5].ownerId).toBe("ankur");
    expect(state.baseVersion).toBe(10);
  });

  it("ignores queued updates that are already included in the grid", () => {
    const state = reducer(loaded(), cellUpdated(update(5, "rahul", 9)));
    expect(state.cells[5].ownerId).toBe("ankur");
  });

  it("ignores an update with exactly the grid's version", () => {
    const state = reducer(loaded(), cellUpdated(update(5, "rahul", 10)));
    expect(state.cells[5].ownerId).toBe("ankur");
  });

  it("applies updates newer than the grid", () => {
    const state = reducer(loaded(), cellUpdated(update(5, "rahul", 11)));
    expect(state.cells[5].ownerId).toBe("rahul");
  });

  it("applies new updates to cells that were unclaimed in the grid", () => {
    let state = reducer(loaded(), cellUpdated(update(99, "rahul", 8)));
    expect(state.cells[99]).toBeUndefined();
    state = reducer(state, cellUpdated(update(99, "rahul", 12)));
    expect(state.cells[99].ownerId).toBe("rahul");
  });

  it("ignores duplicates and late, out-of-order messages", () => {
    let state = reducer(loaded(), cellUpdated(update(5, "rahul", 15)));
    state = reducer(state, cellUpdated(update(5, "rahul", 15)));
    state = reducer(state, cellUpdated(update(5, "priya", 12)));
    expect(state.cells[5].ownerId).toBe("rahul");
    expect(state.cells[5].version).toBe(15);
  });

  it("starts fresh from a new grid after reconnecting", () => {
    let state = reducer(loaded(), cellUpdated(update(5, "rahul", 15)));
    state = reducer(state, gridLoaded({
      ...grid,
      version: 20,
      cells: [{ cellId: 5, ownerId: "priya", color: "#00ff00", lockedUntil: 0 }],
    }));
    state = reducer(state, cellUpdated(update(5, "rahul", 18)));
    expect(state.cells[5].ownerId).toBe("priya");
    expect(state.baseVersion).toBe(20);
  });
});
