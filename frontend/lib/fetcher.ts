/**
 * SWR fetcher — simple fetch wrapper with error handling.
 *
 * Usage:
 *   const { data, error, isLoading } = useSWR('/api/...', fetcher);
 */
export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const info = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${info || res.statusText}`);
  }
  return res.json() as Promise<T>;
}
