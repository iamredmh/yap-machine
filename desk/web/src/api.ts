export class ApiError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.message ?? `Something went wrong (${res.status})`);
  return json as T;
}

export const api = {
  get: <T = any>(p: string) => call<T>("GET", p),
  post: <T = any>(p: string, b?: unknown) => call<T>("POST", p, b ?? {}),
  del: <T = any>(p: string) => call<T>("DELETE", p),
};

/** Server-sent events from the desk: project files changed, desk files changed, prep progress. */
export function subscribe(on: (type: string, data: any) => void): () => void {
  let es: EventSource | null = null;
  let stopped = false;
  const open = () => {
    es = new EventSource("/api/events");
    for (const t of ["project", "desk", "job"]) es.addEventListener(t, (e) => on(t, JSON.parse((e as MessageEvent).data)));
    es.onerror = () => { es?.close(); if (!stopped) setTimeout(open, 1500); };
  };
  open();
  return () => { stopped = true; es?.close(); };
}

export const tc = (t: number) => {
  t = Math.max(0, t || 0);
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
};
export const tcLong = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
export const media = (project: string, rel: string) => `/media/${encodeURIComponent(project)}/${rel}`;
