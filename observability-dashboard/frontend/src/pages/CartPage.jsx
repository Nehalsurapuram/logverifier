import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function CartPage() {
  const { lines, subtotalFormatted, setQuantity, remove, clear } = useCart();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  if (lines.length === 0) {
    return (
      <div className="empty">
        <p>Your cart is empty.</p>
        <Link to="/" className="btn">
          Browse the catalogue
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1>Cart</h1>
      <p className="lede">
        Nothing is reserved yet — stock is taken when the order is placed at checkout.
      </p>

      <div className="split">
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Price</th>
                <th className="num">Qty</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.productId}>
                  <td>
                    <Link to={`/products/${line.productId}`}>{line.name}</Link>
                    <div className="sku mono">{line.sku}</div>
                  </td>
                  <td className="num">{line.formattedPrice}</td>
                  <td className="num" style={{ width: 90 }}>
                    <input
                      type="number"
                      min="1"
                      max={line.stock}
                      value={line.quantity}
                      onChange={(e) => setQuantity(line.productId, Number(e.target.value))}
                    />
                  </td>
                  <td className="num">
                    {((line.unitPriceCents * line.quantity) / 100).toFixed(2)} USD
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => remove(line.productId)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button type="button" className="btn btn-sm" style={{ marginTop: 14 }} onClick={clear}>
            Empty cart
          </button>
        </div>

        <div className="card stack">
          <h2>Summary</h2>
          <div className="totals">
            <div>
              <span>Subtotal</span>
              <span>{subtotalFormatted}</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              <span>Tax</span>
              <span>calculated at checkout</span>
            </div>
          </div>

          <p className="muted" style={{ fontSize: 13 }}>
            The server recalculates every total from its own prices, so this is an estimate.
          </p>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => navigate(isAuthenticated ? '/checkout' : '/login?next=/checkout')}
          >
            {isAuthenticated ? 'Checkout' : 'Sign in to checkout'}
          </button>
        </div>
      </div>
    </>
  );
}
