import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { getLeaderboard } from "./api.js";
import { leaderboardLoaded, toastShown } from "./store/gameSlice.js";
import { startSocket } from "./socket.js";
import JoinScreen from "./components/JoinScreen.jsx";
import Grid from "./components/Grid.jsx";
import TopBar from "./components/TopBar.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import Toast from "./components/Toast.jsx";

export default function App() {
  const dispatch = useDispatch();
  const token = useSelector((state) => state.user.token);

  useEffect(() => {
    if (!token) return undefined;
    const stop = startSocket(token, dispatch);
    getLeaderboard()
      .then((top) => dispatch(leaderboardLoaded(top)))
      .catch((error) => {
        console.error("Could not load leaderboard:", error);
        dispatch(toastShown("Could not load the leaderboard."));
      });
    return stop;
  }, [dispatch, token]);

  if (!token) return <JoinScreen />;
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-5 text-zinc-100 sm:px-8">
      <TopBar />
      <div className="mx-auto mt-6 grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Grid />
        <Leaderboard />
      </div>
      <Toast />
    </main>
  );
}
