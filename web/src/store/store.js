import { configureStore } from "@reduxjs/toolkit";
import gameReducer from "./gameSlice.js";
import userReducer from "./userSlice.js";

export const store = configureStore({
  reducer: {
    game: gameReducer,
    user: userReducer,
  },
});

let savedToken = store.getState().user.token;
let savedUser = store.getState().user.user;
store.subscribe(() => {
  const { token, user } = store.getState().user;
  if (token === savedToken && user === savedUser) return;
  savedToken = token;
  savedUser = user;
  if (token && user) {
    localStorage.setItem("grid:token", token);
    localStorage.setItem("grid:user", JSON.stringify(user));
  } else {
    localStorage.removeItem("grid:token");
    localStorage.removeItem("grid:user");
  }
});
