/** Tiny fetch wrapper. Every request carries the local timezone offset so the Worker can compute "today". */
export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-tz': String(new Date().getTimezoneOffset()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || res.statusText, res.status);
  return data as T;
}
export const api = {
  get: <T>(url: string) => call<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => call<T>('POST', url, body),
  del: <T>(url: string) => call<T>('DELETE', url),
};
