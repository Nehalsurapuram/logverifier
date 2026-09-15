import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { ErrorBanner } from '../components/ErrorBanner.jsx';

export function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { add } = useCart();
  const [state, setState] = useState({ status: 'loading', product: null, error: null });
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', product: null, error: null });

    api.products
      .get(id, controller.signal)
      .then(({ data }) => setState({ status: 'ready', product: data, error: null }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState({ status: 'error', product: null, error: err });
      });

    return () => controller.abort();
  }, [id]);

  if (state.status === 'loading') return <div className="card skeleton" style={{ height: 220 }} />;
  if (state.status === 'error') {
    return (
      <>
        <ErrorBanner error={state.error} />
        <Link to="/">Back to the catalogue</Link>
      </>
    );
  }

  const product = state.product;

  return (
    <>
      <p>
        <Link to="/">← Catalogue</Link>
      </p>

      <div className="split">
        <div className="card">
          <span className="sku">{product.sku}</span>
          <h1>{product.name}</h1>
          <p className="muted">{product.description}</p>
          <p className="row">
            <span className="badge badge-muted">{product.category}</span>
            {product.inStock ? (
              <span className="badge badge-ok">{product.stock} in stock</span>
            ) : (
              <span className="badge badge-danger">Out of stock</span>
            )}
          </p>
        </div>

        <div className="card stack">
          <div className="price" style={{ fontSize: 24, fontWeight: 650 }}>
            {product.price.formatted}
          </div>

          <div className="field">
            <label htmlFor="qty">Quantity</label>
            <input
              id="qty"
              type="number"
              min="1"
              max={Math.max(product.stock, 1)}
              value={quantity}
              disabled={!product.inStock}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            />
            {product.inStock ? <div className="hint">{product.stock} available</div> : null}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={!product.inStock}
            onClick={() => {
              add(product, quantity);
              navigate('/cart');
            }}
          >
            Add to cart
          </button>
        </div>
      </div>

      {product.related.length > 0 ? (
        <section style={{ marginTop: 32 }}>
          <h2>More in {product.category}</h2>
          <div className="grid">
            {product.related.map((item) => (
              <article key={item.id} className="card product">
                <span className="sku">{item.sku}</span>
                <Link to={`/products/${item.id}`} className="name">
                  {item.name}
                </Link>
                <span className="price">{item.price.formatted}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
