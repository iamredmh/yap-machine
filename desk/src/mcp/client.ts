/** Thin HTTP client for the desk's API, used by the MCP server and the CLI. From Rushes. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; message?: string; [k: string]: unknown },
  ) {
    super(body.message ?? `The Yap Machine desk returned ${status}`);
  }
}

export class DeskClient {
  constructor(readonly baseUrl: string) {}

  private async call<T>(method: string, path: string, json?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: json === undefined ? {} : { "content-type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiError(res.status, { error: "not_json", message: `The desk returned ${res.status} with a body that isn't JSON` });
    }
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  }

  get<T = any>(path: string) { return this.call<T>("GET", path); }
  post<T = any>(path: string, json: unknown) { return this.call<T>("POST", path, json); }
}
