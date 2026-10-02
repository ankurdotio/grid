async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error ?? data?.errors?.[0]?.msg ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

export function join(name, color) {
  return request("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
}

export function getGrid() {
  return request("/api/grid");
}

export function getLeaderboard() {
  return request("/api/leaderboard");
}
