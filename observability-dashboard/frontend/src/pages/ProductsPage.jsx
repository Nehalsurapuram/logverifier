import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { ErrorBanner } from '../components/ErrorBanner.jsx';

const CATEGORIES = ['audio', 'peripherals', 'displays', 'accessories'];

export function ProductsPage() {
  // Filters live in the URL, so a filtered catalogue is a shareable link and
  // the back button behaves the way people expect.
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const { add } = useCart();

  const page = Number(params.get('page') ?? 1);
  const query = {
    page,
    limit: 12,
    category: params.get('category') ?? '',
    search: params.get('search') ?? '',
    sort: params.get('sort') ?? 'newest',
  };

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading' }));

    api.products
      .list(query, controller.signal)
      .then(({ data }) => setState({ status: 'ready', data, error: null }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState({ status: 'error', data: null, error: err });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  function update(patch) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change invalidates the page number.
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  }

  return (
    <>
      <h1>Catalogue</h1>
      <p className="lede">
        Every request here hits the real API — filtered, sorted and paginated in PostgreSQL.
      </p>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="search">Search</label>
          <input
            id="search"
            defaultValue={query.search}
            placeholder="keyboard, monitor…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') update({ search: e.currentTarget.value.trim() });
            }}
            onBlur={(e) => update({ search: e.currentTarget.value.trim() })}
          />
        </div>

        <div className="field">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={query.category}
            onChange={(e) => update({ category: e.target.value })}
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="sort">Sort</label>
          <select id="sort" value={query.sort} onChange={(e) => update({ sort: e.target.value })}>
            <option value="newest">Newest</option>
            <option value="price_asc">Price, low to high</option>
            <option value="price_desc">Price, high to low</option>
            <option value="name_asc">Name</option>
          </select>
        </div>

        {params.toString() ? (
          <button type="button" className="btn" onClick={() => setParams(new URLSearchParams())}>
            Reset
          </button>
        ) : null}
      </div>

      <ErrorBanner error={state.error} />

      {state.status === 'loading' ? (
        <div className="grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card skeleton" style={{ height: 170 }} />
          ))}
        </div>
      ) : null}

      {state.status === 'ready' && state.data.items.length === 0 ? (
        <div className="empty">No products match those filters.</div>
      ) : null}

      {state.status === 'ready' && state.data.items.length > 0 ? (
        <>
          <div className="grid">
            {state.data.items.map((product) => (
              <article key={product.id} className="card product">
                <span className="sku">{product.sku}</span>
                <Link to={`/products/${product.id}`} className="name">
                  {product.name}
                </Link>
                <span className="price">{product.price.formatted}</span>
                <span className="spacer" />
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  {product.inStock ? (
                    <span className="badge badge-ok">{product.stock} in stock</span>
                  ) : (
                    <span className="badge badge-muted">Out of stock</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!product.inStock}
                    onClick={() => add(product)}
                  >
                    Add to cart
                  </button>
                </div>
              </article>
            ))}
          </div>

          <Pagination pagination={state.data.pagination} onPage={(p) => update({ page: String(p) })} />
        </>
      ) : null}
    </>
  );
}

function Pagination({ pagination, onPage }) {
  if (pagination.totalPages <= 1) return null;

  return (
    <div className="pagination">
      <button
        type="button"
        className="btn"
        disabled={pagination.page <= 1}
        onClick={() => onPage(pagination.page - 1)}
      >
        Previous
      </button>
      <span className="muted">
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} products
      </span>
      <button
        type="button"
        className="btn"
        disabled={!pagination.hasNextPage}
        onClick={() => onPage(pagination.page + 1)}
      >
        Next
      </button>
    </div>
  );
}
