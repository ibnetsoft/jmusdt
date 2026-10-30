// Administrator data remains in memory only and is cleared on authentication changes.
const values = new Map<string, { value: unknown; expires: number }>();
const requests = new Map<string, Promise<Response>>();
const listeners = new Set<() => void>();
let generation = 0;
const lifetime = 60_000;
export const adminEndpoints = [
  "/api/admin",
  "/api/admin/orders?q=&status=all",
  "/api/admin/products",
  "/api/admin/marketing?type=all&status=all&q=&page=1",
  "/api/admin/grades?q=",
  "/api/admin/exchange-rate",
  "/api/admin/sweeps?q=&page=1&historyPage=1&scan=0",
];
export function getAdminData<T>(endpoint: string): T | null {
  const entry = values.get(endpoint);
  return entry && entry.expires > Date.now() ? entry.value as T : null;
}
export function subscribeAdminData(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function clearAdminData() { generation++; values.clear(); requests.clear(); for (const fn of listeners) fn(); }
export async function fetchAdminData(endpoint: string, signal?: AbortSignal): Promise<Response> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let request = requests.get(endpoint);
  if (!request) {
    const started = generation;
    request = fetch(endpoint, { cache: "no-store" }).then(async response => {
      if (response.status === 401 || response.status === 403) clearAdminData();
      else if (response.ok) {
        const value = await response.clone().json();
        if (generation === started) { values.set(endpoint, { value, expires: Date.now() + lifetime }); for (const fn of listeners) fn(); }
      }
      return response;
    });
    requests.set(endpoint, request);
    const active = request;
    void request.finally(() => { if (requests.get(endpoint) === active) requests.delete(endpoint); }).catch(() => {});
  }
  const response = await request;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return response.clone();
}
export function preloadAdminData() {
  for (const endpoint of adminEndpoints) void fetchAdminData(endpoint).catch(() => {});
}
