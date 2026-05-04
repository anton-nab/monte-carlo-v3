/**
 * API client utility
 * ==================
 *
 * QUOI: Centralise tous les appels au backend.
 * POURQUOI: Eviter de dupliquer la logique d'URL et de parsing dans chaque
 *           composant. Si l'URL backend change, on touche un seul endroit.
 *
 * Bonus: gere la normalisation du trailing slash (bug Phase 0).
 */

/** Base URL du backend, sans trailing slash garanti. */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Wrapper fetch avec parsing JSON et gestion d'erreur uniforme.
 * Usage: const data = await apiFetch<MyType>('/api/macro/us/inflation');
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(response.status, text || response.statusText);
  }

  return response.json() as Promise<T>;
}
