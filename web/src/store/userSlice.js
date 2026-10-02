import { createSlice } from "@reduxjs/toolkit";

function loadStoredCredentials() {
  try {
    const token = localStorage.getItem("grid:token");
    const savedUser = localStorage.getItem("grid:user");
    const user = savedUser ? JSON.parse(savedUser) : null;
    if (user && typeof user.id === "string" && typeof user.name === "string"
      && typeof user.color === "string" && token) return { user, token };
    if (token || savedUser) {
      localStorage.removeItem("grid:token");
      localStorage.removeItem("grid:user");
    }
  } catch (error) {
    console.error("Could not read saved credentials:", error);
    localStorage.removeItem("grid:token");
    localStorage.removeItem("grid:user");
  }
  return { user: null, token: null };
}

const userSlice = createSlice({
  name: "user",
  initialState: loadStoredCredentials(),
  reducers: {
    credentialsSet(state, action) {
      state.user = action.payload.user;
      state.token = action.payload.token;
    },
    credentialsCleared(state) {
      state.user = null;
      state.token = null;
    },
  },
});

export const { credentialsSet, credentialsCleared } = userSlice.actions;
export default userSlice.reducer;
