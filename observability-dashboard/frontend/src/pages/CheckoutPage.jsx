import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { ErrorBanner } from '../components/ErrorBanner.jsx';

/** The sandbox cards the mock provider recognises. */
const TEST_CARDS = [
  { number: '4242424242424242', label: 'Succeeds' },
  { number: '4000000000000002', label: 'Declined' },
  { number: '4000000000009995', label: 'Insufficient funds' },
  { number: '4000000000000119', label: 'Provider failure (502)' },
];

/**
 * Checkout is two steps because the backend models it that way: placing the
 * order reserves stock, paying it is a separate attempt that can fail and be
 * retried against the same order.
 */
export function CheckoutPage() {
  const { token } = useAuth();
  const { lines, toOrderItems, clear } = useCart();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState({
    number: TEST_CARDS[0].number,
    expiryMonth: 12,
    expiryYear: new Date().getFullYear() + 2,
    cvc: '123',
    holderName: '',
  });

  if (lines.length === 0 && !order) {
    return (
      <div className="empty">
        <p>Nothing to check out.</p>
        <Link to="/" className="btn">
          Browse the catalogue
        </Link>
      </div>
    );
  }

  async function placeOrder() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.orders.create(toOrderItems(), token);
      setOrder(data);
      // The cart has become an order; keeping it would let the customer buy
      // the same basket twice by accident.
      clear();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function pay(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.payments.create({ orderId: order.id, card }, token);
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      // A decline leaves the order intact and retryable, so stay on the page.
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Checkout</h1>
      <p className="lede">
        {order
          ? 'Order placed and stock reserved. Pay to complete it.'
          : 'Review the order before it is placed.'}
      </p>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="split">
        <div className="card">
          <h2>{order ? `Order ${order.id.slice(0, 8)}` : 'Your basket'}</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {(order ? order.items : lines).map((line) => (
                <tr key={line.productId}>
                  <td>{line.name}</td>
                  <td className="num">{line.quantity}</td>
                  <td className="num">
                    {order
                      ? line.lineTotal.formatted
                      : `${((line.unitPriceCents * line.quantity) / 100).toFixed(2)} USD`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {order ? (
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
          ) : null}
        </div>

        <div className="card stack">
          {!order ? (
            <>
              <h2>Place order</h2>
              <p className="muted" style={{ fontSize: 13 }}>
                This reserves stock. Tax is calculated by the server.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={busy}
                onClick={placeOrder}
              >
                {busy ? 'Placing…' : 'Place order'}
              </button>
            </>
          ) : (
            <form onSubmit={pay}>
              <h2>Payment</h2>

              <div className="field">
                <label htmlFor="card">Test card</label>
                <select
                  id="card"
                  value={card.number}
                  onChange={(e) => setCard({ ...card, number: e.target.value })}
                >
                  {TEST_CARDS.map((c) => (
                    <option key={c.number} value={c.number}>
                      {c.label} — {c.number.slice(-4)}
                    </option>
                  ))}
                </select>
                <div className="hint">
                  Pick a failing card to see the error paths. Nothing is ever charged.
                </div>
              </div>

              <div className="field">
                <label htmlFor="holder">Name on card</label>
                <input
                  id="holder"
                  value={card.holderName}
                  onChange={(e) => setCard({ ...card, holderName: e.target.value })}
                  required
                />
              </div>

              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="exp">Expiry month</label>
                  <input
                    id="exp"
                    type="number"
                    min="1"
                    max="12"
                    value={card.expiryMonth}
                    onChange={(e) => setCard({ ...card, expiryMonth: Number(e.target.value) })}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="expy">Year</label>
                  <input
                    id="expy"
                    type="number"
                    value={card.expiryYear}
                    onChange={(e) => setCard({ ...card, expiryYear: Number(e.target.value) })}
                  />
                </div>
                <div className="field" style={{ width: 90 }}>
                  <label htmlFor="cvc">CVC</label>
                  <input
                    id="cvc"
                    value={card.cvc}
                    onChange={(e) => setCard({ ...card, cvc: e.target.value })}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={busy}
              >
                {busy ? 'Authorising…' : `Pay ${order.totals.total.formatted}`}
              </button>

              <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                A declined payment leaves this order open — you can try another card.
              </p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
