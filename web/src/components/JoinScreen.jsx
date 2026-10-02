import { useState } from "react";
import { useDispatch } from "react-redux";
import { join } from "../api.js";
import { credentialsSet } from "../store/userSlice.js";

export default function JoinScreen() {
  const dispatch = useDispatch();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setJoining(true);
    setError("");
    try {
      dispatch(credentialsSet(await join(name, color)));
    } catch (requestError) {
      console.error("Could not join the grid:", requestError);
      setError(requestError.message);
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 p-4 text-zinc-100">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-7">
        <h1 className="text-2xl font-semibold">Shared Grid</h1>
        <p className="mt-2 text-sm text-zinc-400">Choose a name and color to join the board.</p>
        <label className="mt-6 block text-sm text-zinc-300" htmlFor="name">Name</label>
        <input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={20}
          required
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-violet-500"
        />
        <label className="mt-4 block text-sm text-zinc-300" htmlFor="color">Color</label>
        <input
          id="color"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          className="mt-2 h-10 w-full cursor-pointer rounded-lg border border-zinc-700 bg-zinc-950 p-1"
        />
        {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
        <button
          disabled={joining}
          className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {joining ? "Joining…" : "Join the grid"}
        </button>
      </form>
    </main>
  );
}
