import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBanner } from '../components/ErrorBanner.jsx';

const STATUS_BADGE = {
  paid: 'badge-ok',
  pending_payment: 'badge-warn',
  payment_failed: 'badge-danger',
  cancelled: 'badge-muted',
};

export function StatusBadge({ status }) {
  return (
    <span className={`badge ${STATUS_BADGE[status] ?? 'badge-muted'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function OrdersPage() {
  const { token } = useAuth();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    api.orders
      .list({ limit: 20 }, token)
      .then(({ data }) => setState({ status: 'ready', data, error: null }))
      .catch((error) => setState({ status: 'error', data: null, error }));
  }, [token]);

  if (state.status === 'loading') return <div className="card skeleton" style={{ height: 200 }} />;
  if (state.status === 'error') return <ErrorBanner error={state.error} />;

  if (state.data.items.length === 0) {
    return (
      <div className="empty">
        <p>No orders yet.</p>
        <Link to="/" className="btn">
          Browse the catalogue
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1>Your orders</h1>
      <p className="lede">Scoped to your account — another user&apos;s order simply does not exist.</p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Placed</th>
              <th>Status</th>
              <th className="num">Items</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((order) => (
              <tr key={order.id}>
                <td>
                  <Link to={`/orders/${order.id}`} className="mono">
                    {order.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="muted">{new Date(order.createdAt).toLocaleString()}</td>
                <td>
                  <StatusBadge status={order.status} />
                </td>
                <td className="num">{order.itemCount}</td>
                <td className="num">{order.totals.total.formatted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [state, setState] = useState({ status: 'loading', order: null, error: null });

  useEffect(() => {
    api.orders
      .get(id, token)
      .then(({ data }) => setState({ status: 'ready', order: data, error: null }))
      .catch((error) => setState({ status: 'error', order: null, error }));
  }, [id, token]);

  if (state.status === 'loading') return <div className="card skeleton" style={{ height: 240 }} />;
  if (state.status === 'error') {
    return (
      <>
        <ErrorBanner error={state.error} />
        <Link to="/orders">Back to orders</Link>
      </>
    );
  }

  const order = state.order;

  return (
    <>
      <p>
        <Link to="/orders">← Orders</Link>
      </p>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 className="mono" style={{ fontSize: 20 }}>
          {order.id}
        </h1>
        <StatusBadge status={order.status} />
      </div>
      <p className="lede">Placed {new Date(order.createdAt).toLocaleString()}</p>

      {order.status === 'paid' ? (
        <div className="alert alert-ok">
          <span className="alert-title">Payment complete.</span> Stock has been deducted.
        </div>
      ) : null}
      {order.status === 'payment_failed' ? (
        <div className="alert alert-error">
          <span className="alert-title">The last payment attempt failed.</span> Stock is still
          reserved, so you can retry from the checkout with a different card.
        </div>
      ) : null}

      <div className="split">
        <div className="card">
          <h2>Items</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Unit</th>
                <th className="num">Qty</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((line) => (
                <tr key={line.productId}>
                  <td>
                    {line.name}
                    <div className="sku mono">{line.sku}</div>
                  </td>
                  <td className="num">{line.unitPrice.formatted}</td>
                  <td className="num">{line.quantity}</td>
                  <td className="num">{line.lineTotal.formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Totals</h2>
          <div className="totals">
            <div>
              <span>Subtotal</span>
              <span>{order.totals.subtotal.formatted}</span>
            </div>
            <div>
              <span>Tax</span>
              <span>{order.totals.tax.formatted}</span>
            </div>
            <div className="grand">
              <span>Total</span>
              <span>{order.totals.total.formatted}</span>
            </div>
          </div>

          {order.payment ? (
            <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
              Last payment attempt: <strong>{order.payment.status}</strong>{' '}
              {new Date(order.payment.at).toLocaleString()}
            </p>
          ) : (
            <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
              No payment attempted yet.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
