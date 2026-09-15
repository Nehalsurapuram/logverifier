/**
 * Thin client over the backend API.
 *
 * Two things it does deliberately:
 *
 * 1. It unwraps the `{ data, meta }` / `{ error }` envelope so components never
 *    reach into response shapes themselves.
 * 2. It keeps the `requestId` on every failure. That id is stamped on every log
 *    line the request produced, so when the UI shows an error it can show the
 *    exact string you paste into a log query. That is the whole point of the
 *    correlation plumbing in the backend, and it is wasted if the browser
 *    throws it away.
 *
 * All requests are same-origin: the Vite dev server and nginx both proxy /api
 * to the backend, so CORS never enters the picture.
 */

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level problems from a 400, flattened for display next to inputs. */
  get fieldIssues() {
    if (this.code !== 'VALIDATION_ERROR') return {};
    return Object.fromEntries(
      (this.details?.issues ?? []).map((issue) => [issue.field, issue.message]),
    );
  }
}

async function request(path, { method = 'GET', body, token, signal } = {}) {
  let response;

  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // The backend never answered at all — a different failure from any status
    // code, and worth saying so rather than showing a generic message.
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Is the backend running?',
    });
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError({
      status: response.status,
      code: error.code ?? 'UNEXPECTED_ERROR',
      message: error.message ?? `Request failed with status ${response.status}`,
      details: error.details,
      requestId: error.requestId ?? response.headers.get('x-request-id'),
    });
  }

  return { data: payload?.data, meta: payload?.meta };
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}

export const api = {
  auth: {
    register: (body) => request('/api/auth/register', { method: 'POST', body }),
    login: (body) => request('/api/auth/login', { method: 'POST', body }),
    me: (token) => request('/api/auth/me', { token }),
  },
  products: {
    list: (params, signal) => request(`/api/products${queryString(params)}`, { signal }),
    get: (id, signal) => request(`/api/products/${id}`, { signal }),
  },
  orders: {
    create: (items, token) => request('/api/orders', { method: 'POST', body: { items }, token }),
    list: (params, token) => request(`/api/orders${queryString(params)}`, { token }),
    get: (id, token) => request(`/api/orders/${id}`, { token }),
  },
  payments: {
    create: (body, token) => request('/api/payments', { method: 'POST', body, token }),
  },
  // The probes are not wrapped in the envelope, so they are fetched directly.
  health: async () => {
    const response = await fetch('/health');
    return response.json();
  },
};
