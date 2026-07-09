export async function apiPost(url, body = {}, options = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...options,
  });
  return response.json();
}
