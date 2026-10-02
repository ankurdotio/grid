import { getGrid } from "./api.js";
import {
  cellUpdated,
  connectionChanged,
  effectCleared,
  effectSet,
  gridLoaded,
  leaderboardLoaded,
  onlineChanged,
  pendingAdded,
  pendingRemoved,
  toastShown,
} from "./store/gameSlice.js";
import { credentialsCleared } from "./store/userSlice.js";

let activeSocket;
let activeDispatch;
let reconnectTimer;
let pendingTimers = new Map();
let retryDelay = 1000;
let stopped = true;
function clearPendingTimer(cellId) {
  const timer = pendingTimers.get(cellId);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(cellId);
}
function showEffect(dispatch, cellId, effect) {
  dispatch(effectSet({ cellId, effect }));
  setTimeout(() => dispatch(effectCleared(cellId)), effect === "pop" ? 350 : 300);
}
function handleClaimResult(message, dispatch) {
  clearPendingTimer(message.cellId);
  dispatch(pendingRemoved(message.cellId));
  if (message.ok) {
    dispatch(cellUpdated(message.cell));
    showEffect(dispatch, message.cellId, "pop");
  } else if (message.reason === "locked") {
    showEffect(dispatch, message.cellId, "shake");
    const seconds = Math.max(0, Math.ceil((message.lockedUntil - Date.now()) / 1000));
    dispatch(toastShown(`Locked by ${message.ownerName ?? "another player"} for ${seconds}s`));
  } else if (message.reason === "rate_limited") {
    dispatch(toastShown("Slow down!"));
  } else {
    dispatch(toastShown("That cell could not be claimed."));
  }
}
function connect(token, dispatch) {
  if (stopped) return;
  dispatch(connectionChanged("connecting"));
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);
  activeSocket = socket;
  let syncing = false;
  let queuedCells = [];

  socket.addEventListener("open", async () => {
    if (activeSocket !== socket || stopped) return;
    retryDelay = 1000;
    dispatch(connectionChanged("connected"));
    // Open the socket before fetching the snapshot, or intervening updates could be lost.
    syncing = true;
    queuedCells = [];
    try {
      const grid = await getGrid();
      if (activeSocket !== socket || stopped) return;
      dispatch(gridLoaded(grid));
      for (const cell of queuedCells) dispatch(cellUpdated(cell));
      queuedCells = [];
      syncing = false;
    } catch (error) {
      console.error("Could not load grid snapshot:", error);
      dispatch(toastShown("Could not load the grid. Retrying when reconnected."));
      socket.close();
    }
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Received invalid WebSocket message:", error);
      return;
    }
    if (message.type === "cell") {
      if (syncing) queuedCells.push(message);
      else dispatch(cellUpdated(message));
    } else if (message.type === "leaderboard") {
      dispatch(leaderboardLoaded(message.top));
    } else if (message.type === "online") {
      dispatch(onlineChanged(message.count));
    } else if (message.type === "claim_result") {
      handleClaimResult(message, dispatch);
    }
  });

  socket.addEventListener("close", (event) => {
    if (activeSocket !== socket || stopped) return;
    activeSocket = undefined;
    if (event.code === 4001) {
      stopped = true;
      dispatch(credentialsCleared());
      dispatch(connectionChanged("disconnected"));
      return;
    }
    dispatch(connectionChanged("reconnecting"));
    reconnectTimer = setTimeout(() => {
      connect(token, dispatch);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    }, retryDelay);
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket connection error:", error);
  });
}

export function startSocket(token, dispatch) {
  stopSocket();
  activeDispatch = dispatch;
  stopped = false;
  connect(token, dispatch);
  return stopSocket;
}

export function stopSocket() {
  stopped = true;
  activeDispatch = undefined;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  for (const timer of pendingTimers.values()) clearTimeout(timer);
  pendingTimers.clear();
  if (activeSocket) {
    activeSocket.close();
    activeSocket = undefined;
  }
}

export function sendClaim(cellId) {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN || !activeDispatch) return false;
  activeDispatch(pendingAdded(cellId));
  clearPendingTimer(cellId);
  pendingTimers.set(cellId, setTimeout(() => {
    pendingTimers.delete(cellId);
    activeDispatch?.(pendingRemoved(cellId));
  }, 5000));
  activeSocket.send(JSON.stringify({ type: "claim", cellId }));
  return true;
}
