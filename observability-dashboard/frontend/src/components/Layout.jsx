import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';

export function Layout() {
  const { isAuthenticated, user, logout } = useAuth();
  const { itemCount } = useCart();

  return (
    <div className="shell">
      <header className="header">
        <div className="header-inner">
          <NavLink to="/" className="brand">
            Northwind Supply<span>observability demo</span>
          </NavLink>

          <nav className="nav">
            <NavLink to="/">Catalogue</NavLink>
            <NavLink to="/cart">
              Cart
              {itemCount > 0 ? <span className="cart-count">{itemCount}</span> : null}
            </NavLink>
            {isAuthenticated ? <NavLink to="/orders">Orders</NavLink> : null}
            <NavLink to="/status">Status</NavLink>

            {isAuthenticated ? (
              <>
                <span className="muted" style={{ fontSize: 14 }}>
                  {user?.name}
                </span>
                <button type="button" className="btn btn-sm" onClick={logout}>
                  Sign out
                </button>
              </>
            ) : (
              <NavLink to="/login">Sign in</NavLink>
            )}
          </nav>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer">
        A deliberately realistic sample shop. Payments are simulated — see the README for the test
        card numbers.
      </footer>
    </div>
  );
}
