import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toastCleared } from "../store/gameSlice.js";

export default function Toast() {
  const dispatch = useDispatch();
  const toast = useSelector((state) => state.game.toast);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => dispatch(toastCleared()), 3500);
    return () => clearTimeout(timer);
  }, [dispatch, toast]);

  if (!toast) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm shadow-xl">
      {toast}
    </div>
  );
}
