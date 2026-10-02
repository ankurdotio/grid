import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  cells: {},
  baseVersion: 0,
  gridSize: 40,
  lockMs: 10_000,
  pending: {},
  clockOffset: 0,
  leaderboard: [],
  online: 0,
  connectionStatus: "disconnected",
  toast: null,
  effects: {},
};

const gameSlice = createSlice({
  name: "game",
  initialState,
  reducers: {
    gridLoaded(state, action) {
      const { gridSize, lockMs, serverTime, version, cells, users } = action.payload;
      state.cells = Object.fromEntries(cells.map((cell) => [
        cell.cellId,
        { ...cell, ownerName: users[cell.ownerId]?.name ?? "Unknown" },
      ]));
      state.baseVersion = version;
      state.gridSize = gridSize;
      state.lockMs = lockMs;
      state.clockOffset = serverTime - Date.now();
    },
    cellUpdated(state, action) {
      const update = action.payload;
      const currentVersion = state.cells[update.cellId]?.version ?? state.baseVersion;
      if (update.version > currentVersion) {
        state.cells[update.cellId] = { ...update };
      }
    },
    leaderboardLoaded(state, action) {
      state.leaderboard = action.payload;
    },
    onlineChanged(state, action) {
      state.online = action.payload;
    },
    connectionChanged(state, action) {
      state.connectionStatus = action.payload;
    },
    pendingAdded(state, action) {
      state.pending[action.payload] = true;
    },
    pendingRemoved(state, action) {
      delete state.pending[action.payload];
    },
    effectSet(state, action) {
      state.effects[action.payload.cellId] = action.payload.effect;
    },
    effectCleared(state, action) {
      delete state.effects[action.payload];
    },
    toastShown(state, action) {
      state.toast = action.payload;
    },
    toastCleared(state) {
      state.toast = null;
    },
  },
});

export const {
  gridLoaded,
  cellUpdated,
  leaderboardLoaded,
  onlineChanged,
  connectionChanged,
  pendingAdded,
  pendingRemoved,
  effectSet,
  effectCleared,
  toastShown,
  toastCleared,
} = gameSlice.actions;
export default gameSlice.reducer;
