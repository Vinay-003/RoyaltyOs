export type SupabaseRequestOptions = {
  method?: string;
  query?: URLSearchParams | Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  prefer?: string;
  token?: string;
};

function queryString(input?: SupabaseRequestOptions["query"]) {
  if (!input) return "";
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export class SupabaseClient {
  private readonly url: string;
  private readonly anonKey: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(url: string, anonKey: string, serviceRoleKey: string, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.anonKey = anonKey;
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = fetchImpl;
  }

  private async request(path: string, options: SupabaseRequestOptions = {}, service = true) {
    const key = service ? this.serviceRoleKey : this.anonKey;
    const headers: Record<string, string> = {
      apikey: key,
      Authorization: `Bearer ${options.token ?? key}`,
      ...(options.headers ?? {}),
    };
    if (options.body !== undefined && !(options.body instanceof Uint8Array) && !(options.body instanceof ArrayBuffer) && !(options.body instanceof Blob)) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    if (options.prefer) headers.Prefer = options.prefer;
    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };
    if (options.body !== undefined) {
      requestInit.body = headers["Content-Type"] === "application/json"
        ? JSON.stringify(options.body)
        : (options.body as BodyInit);
    }
    const response = await this.fetchImpl(`${this.url}${path}${queryString(options.query)}`, requestInit);
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!response.ok) {
      const message = typeof payload === "object" && payload && "message" in payload
        ? String((payload as Record<string, unknown>).message)
        : typeof payload === "string" ? payload : `Supabase HTTP ${response.status}`;
      throw new Error(message);
    }
    return { response, payload };
  }

  async select<T>(table: string, query: Record<string, string> = {}) {
    const result = await this.request(`/rest/v1/${table}`, { query });
    return result.payload as T[];
  }

  async insert<T>(table: string, rows: unknown, returning = true) {
    const result = await this.request(`/rest/v1/${table}`, {
      method: "POST",
      body: rows,
      prefer: returning ? "return=representation" : "return=minimal",
    });
    return result.payload as T[];
  }

  async delete<T>(table: string, query: Record<string, string>) {
    const result = await this.request(`/rest/v1/${table}`, {
      method: "DELETE",
      query,
    });
    return result.payload as T[];
  }

  async update<T>(table: string, patch: unknown, query: Record<string, string>, returning = true) {
    const result = await this.request(`/rest/v1/${table}`, {
      method: "PATCH",
      query,
      body: patch,
      prefer: returning ? "return=representation" : "return=minimal",
    });
    return result.payload as T[];
  }

  async rpc<T>(name: string, args: Record<string, unknown>) {
    const result = await this.request(`/rest/v1/rpc/${name}`, { method: "POST", body: args });
    return result.payload as T;
  }

  async verifyUser(accessToken: string) {
    const result = await this.request("/auth/v1/user", { token: accessToken }, false);
    return result.payload as { id: string; email?: string; user_metadata?: Record<string, unknown> };
  }

  async signUp(email: string, password: string, displayName: string) {
    const result = await this.request("/auth/v1/signup", {
      method: "POST",
      body: { email, password, data: { display_name: displayName } },
    }, false);
    return result.payload as Record<string, unknown>;
  }

  async signIn(email: string, password: string) {
    const result = await this.request("/auth/v1/token", {
      method: "POST",
      query: { grant_type: "password" },
      body: { email, password },
    }, false);
    return result.payload as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      user: { id: string; email: string };
    };
  }

  async adminGetUser(userId: string) {
    const result = await this.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {}, true);
    return result.payload as { id: string; email?: string; user_metadata?: Record<string, unknown> };
  }

  async adminUpdateUser(userId: string, attributes: { displayName?: string }) {
    const body: Record<string, unknown> = {};
    if (typeof attributes.displayName === "string") body.user_metadata = { display_name: attributes.displayName };
    const result = await this.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body,
    }, true);
    return result.payload as { id: string; email?: string; user_metadata?: Record<string, unknown> };
  }

  async refreshSession(refreshToken: string) {
    const result = await this.request("/auth/v1/token", {
      method: "POST",
      query: { grant_type: "refresh_token" },
      body: { refresh_token: refreshToken },
    }, false);
    return result.payload as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      user: { id: string; email: string };
    };
  }

  async uploadPrivateObject(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
    await this.request(`/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      body: bytes,
      headers: { "Content-Type": contentType, "x-upsert": "false" },
    });
    return { bucket, path };
  }

  async downloadPrivateObject(bucket: string, path: string) {
    const response = await this.fetchImpl(`${this.url}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}` },
    });
    if (!response.ok) throw new Error(`Storage download failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async signedObjectUrl(bucket: string, path: string, expiresIn = 300) {
    const result = await this.request(`/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      body: { expiresIn },
    });
    const signedURL = (result.payload as Record<string, unknown>).signedURL;
    if (typeof signedURL !== "string") throw new Error("Supabase did not return a signed URL");
    return signedURL.startsWith("http") ? signedURL : `${this.url}/storage/v1${signedURL}`;
  }
}
