import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * A small window onto the backend's own health endpoint.
 *
 * It exists because this project is about observability: being able to watch
 * pool saturation climb from the same browser that is generating the load makes
 * the cause and effect obvious in a way a Grafana panel in another tab does not.
 */
export function StatusPage() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const poll = () =>
      api
        .health()
        .then((data) => {
          if (!cancelled) {
            setHealth(data);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err);
        });

    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error) {
    return (
      <div className="alert alert-error">
        <span className="alert-title">Cannot reach the backend.</span> Is it running?
      </div>
    );
  }

  if (!health) return <div className="card skeleton" style={{ height: 200 }} />;

  const db = health.dependencies.database;
  const pool = db.pool;

  return (
    <>
      <h1>Service status</h1>
      <p className="lede">Polled from /health every three seconds.</p>

      <div className="split">
        <div className="card stack">
          <h2>Service</h2>
          <div className="totals">
            <div>
              <span>Status</span>
              <span className="badge badge-ok">{health.status}</span>
            </div>
            <div>
              <span>Version</span>
              <span className="mono">{health.version}</span>
            </div>
            <div>
              <span>Environment</span>
              <span className="mono">{health.environment}</span>
            </div>
            <div>
              <span>Uptime</span>
              <span>{health.uptimeSeconds}s</span>
            </div>
          </div>
        </div>

        <div className="card stack">
          <h2>Database</h2>
          <div className="totals">
            <div>
              <span>Status</span>
              <span className={`badge ${db.status === 'up' ? 'badge-ok' : 'badge-danger'}`}>
                {db.status}
              </span>
            </div>
            <div>
              <span>Latency</span>
              <span>{db.latencyMs}ms</span>
            </div>
            <div>
              <span>Reading</span>
              <span className="muted">{db.cached ? 'cached' : 'live'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 20 }}>
        <h2>Connection pool</h2>
        <div className="totals">
          <div>
            <span>In use / max</span>
            <span>
              {pool.inUse} / {pool.max}
            </span>
          </div>
          <div>
            <span>Idle</span>
            <span>{pool.idle}</span>
          </div>
          <div>
            <span>Waiting for a connection</span>
            <span className={pool.waiting > 0 ? 'badge badge-danger' : ''}>{pool.waiting}</span>
          </div>
          <div>
            <span>Saturated</span>
            <span>
              {pool.saturated ? (
                <span className="badge badge-danger">yes</span>
              ) : (
                <span className="badge badge-ok">no</span>
              )}
            </span>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Restart the backend with <code className="mono">DB_POOL_MAX=1</code> and browse the
          catalogue in a few tabs to watch <strong>waiting</strong> climb.
        </p>
      </div>
    </>
  );
}
