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
  signal?: AbortSignal,
): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
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
  submittedBy?: string;
  submittedAt?: string; // ISO 8601
}

// Three-stage pipeline: submitted → approved → active
export interface AdminState {
  active: KioskAd[];
  approved: KioskAd[];
  submitted: KioskAd[];
  denied: KioskAd[];
}

export interface AdminStats {
  kiosk: { running: boolean; pid: number; uptimeSec: number; restarts: number };
  playlist: { active: number; approved: number; submitted: number; denied: number };
  build: string;
  updating: boolean;
  launcherUptimeSec: number;
  nextAutoRestartSec: number;
}

export interface SubmissionItem {
  id: string;
  name: string;
  type: string;
  url: string;
  durationSec: number;
  submittedBy: string;
  submittedAt: string; // ISO 8601
  status: "submitted" | "approved" | "live" | "denied" | "unknown";
}

/** Fetch all submissions for a given submitter email (no auth needed). */
export async function mySubmissions(
  email: string,
): Promise<SubmissionItem[]> {
  if (!email) return [];
  const res = await fetch("/api/my-submissions?email=" + encodeURIComponent(email));
  if (!res.ok) return [];
  return res.json() as Promise<SubmissionItem[]>;
}

/** Permanently retract (delete) one of the caller's own submissions, including media. */
export async function retractMySubmission(
  id: string,
  email: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `/api/my-submissions/${id}?email=` + encodeURIComponent(email),
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
}

/** Fetch the current live playlist in display order (no auth needed). */
export async function liveFeed(): Promise<KioskAd[]> {
  const res = await fetch("/api/live-ads");
  if (!res.ok) return [];
  return res.json() as Promise<KioskAd[]>;
}

export interface RestartWarning {
  nextRestartAt: string;      // ISO 8601
  secUntilRestart: number;
  withinWarningWindow: boolean;
}

/** Poll before uploads / submissions to warn users of an imminent kiosk restart. */
export async function restartWarning(): Promise<RestartWarning | null> {
  try {
    const res = await fetch("/api/restart-warning");
    if (!res.ok) return null;
    return res.json() as Promise<RestartWarning>;
  } catch {
    return null;
  }
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
  login: (password: string, signal?: AbortSignal) =>
    req<{ token: string }>("POST", "/api/admin/auth", { password }, signal),
  logout: () => req<{ ok: boolean }>("DELETE", "/api/admin/logout"),
  state: () => req<AdminState>("GET", "/api/admin/state"),
  stats: () => req<AdminStats>("GET", "/api/admin/stats"),
  reorder: (ids: string[]) =>
    req<{ ok: boolean }>("PUT", "/api/admin/reorder", { ids }),
  // active
  deleteActive: (id: string) =>
    req<{ ok: boolean }>("DELETE", `/api/admin/active/${id}`),
  deactivateActive: (id: string) =>
    req<{ ok: boolean }>("POST", `/api/admin/active/${id}/deactivate`),
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
  // denied
  deleteDenied: (id: string) =>
    req<{ ok: boolean }>("DELETE", `/api/admin/denied/${id}`),
  // duration
  setDuration: (id: string, durationMs: number) =>
    req<{ ok: boolean }>("PATCH", `/api/admin/ads/${id}/duration`, { durationMs }),
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
