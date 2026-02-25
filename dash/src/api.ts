const TOKEN_KEY = 'admin_token'

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string): void {
  sessionStorage.setItem(TOKEN_KEY, t)
}
export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    clearToken()
    throw new Error('unauthorized')
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export interface KioskAd {
  id: string
  name: string
  type: string
  durationMs: number
  src?: string
  html?: string
}

export interface AdminState {
  active: KioskAd[]
  pending: KioskAd[]
}

export const adminApi = {
  login:          (password: string) =>
    req<{ token: string }>('POST', '/api/admin/auth', { password }),
  logout:         () =>
    req<{ ok: boolean }>('DELETE', '/api/admin/logout'),
  state:          () =>
    req<AdminState>('GET', '/api/admin/state'),
  reorder:        (ids: string[]) =>
    req<{ ok: boolean }>('PUT', '/api/admin/reorder', { ids }),
  deleteActive:   (id: string) =>
    req<{ ok: boolean }>('DELETE', `/api/admin/active/${id}`),
  deletePending:  (id: string) =>
    req<{ ok: boolean }>('DELETE', `/api/admin/pending/${id}`),
  approve:        (id: string) =>
    req<{ ok: boolean }>('POST', `/api/admin/pending/${id}/approve`),
  clearActive:    () =>
    req<{ ok: boolean; cleared: number }>('POST', '/api/admin/clear'),
  reload:         () =>
    req<{ ok: boolean }>('POST', '/api/admin/reload'),
}
