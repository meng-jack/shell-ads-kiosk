const TOKEN_KEY = "admin_token";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string): void {
  sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

// Thrown when the server returns 404 — item was already acted on by another admin.
export class NotFoundError extends Error {
  constructor() {
    super("not_found");
    this.name = "NotFoundError";
  }
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    clearToken();
    throw new Error("unauthorized");
  }
  if (res.status === 404) throw new NotFoundError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface KioskAd {
  id: string;
  name: string;
  type: string;
  durationMs: number;
  src?: string;
  html?: string;
}

// Three-stage pipeline: submitted → approved → active
export interface AdminState {
  active: KioskAd[];
  approved: KioskAd[];
  submitted: KioskAd[];
}

export interface AdminStats {
  kiosk: { running: boolean; pid: number; uptimeSec: number; restarts: number };
  playlist: { active: number; approved: number; submitted: number };
  build: string;
  updating: boolean;
}

export type UpdateStage =
  | "idle"
  | "checking"
  | "up_to_date"
  | "downloading"
  | "applying"
  | "restarting"
  | "error";

export interface UpdateStatus {
  stage: UpdateStage;
  message: string;
  current: string;
  latest: string;
  error?: string;
}

export const adminApi = {
  login: (password: string) =>
    req<{ token: string }>("POST", "/api/admin/auth", { password }),
  logout: () => req<{ ok: boolean }>("DELETE", "/api/admin/logout"),
  state: () => req<AdminState>("GET", "/api/admin/state"),
  stats: () => req<AdminStats>("GET", "/api/admin/stats"),
  reorder: (ids: string[]) =>
    req<{ ok: boolean }>("PUT", "/api/admin/reorder", { ids }),
  // active
  deleteActive: (id: string) =>
    req<{ ok: boolean }>("DELETE", `/api/admin/active/${id}`),
  clearActive: () =>
    req<{ ok: boolean; cleared: number }>("POST", "/api/admin/clear"),
  // approved
  deleteApproved: (id: string) =>
    req<{ ok: boolean }>("DELETE", `/api/admin/approved/${id}`),
  activateApproved: (id: string) =>
    req<{ ok: boolean }>("POST", `/api/admin/approved/${id}/activate`),
  // submitted
  approveSubmitted: (id: string) =>
    req<{ ok: boolean }>("POST", `/api/admin/submitted/${id}/approve`),
  deleteSubmitted: (id: string) =>
    req<{ ok: boolean }>("DELETE", `/api/admin/submitted/${id}`),
  // kiosk control
  reload: () =>
    req<{ ok: boolean; activated: number }>("POST", "/api/admin/reload"),
  restartKiosk: () => req<{ ok: boolean }>("POST", "/api/admin/restart-kiosk"),
  kioskNext: () => req<{ ok: boolean }>("POST", "/api/admin/kiosk/next"),
  kioskPrev: () => req<{ ok: boolean }>("POST", "/api/admin/kiosk/prev"),
  // self-update
  triggerUpdate: () =>
    req<{ ok: boolean; reason?: string }>("POST", "/api/admin/trigger-update"),
  updateStatus: () => req<UpdateStatus>("GET", "/api/admin/update-status"),
};
