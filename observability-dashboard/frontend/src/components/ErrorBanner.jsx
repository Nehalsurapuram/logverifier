import { ApiError } from '../lib/api.js';

/**
 * Renders a failure the way the backend described it.
 *
 * It shows the requestId, which is the point of the whole correlation chain:
 * that id is on every log line the failing request produced, so a user can read
 * it off the screen and an engineer can find the request immediately.
 */
export function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;

  const isApi = error instanceof ApiError;
  const issues = isApi ? (error.details?.issues ?? []) : [];

  return (
    <div className="alert alert-error" role="alert">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="alert-title">{error.message}</span>
        {onDismiss ? (
          <button type="button" className="btn btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>

      {issues.length > 0 ? (
        <ul>
          {issues.map((issue) => (
            <li key={`${issue.location}.${issue.field}`}>
              <strong>{issue.field}</strong> {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {isApi && error.status === 409 && error.details?.items ? (
        <ul>
          {error.details.items.map((item) => (
            <li key={item.productId}>
              {item.sku}: asked for {item.requested}, only {item.available} left
            </li>
          ))}
        </ul>
      ) : null}

      {isApi && error.requestId ? (
        <div className="request-id">
          <span>Reference:</span>
          <code className="mono">{error.requestId}</code>
          {error.code ? <span className="badge badge-danger">{error.code}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
