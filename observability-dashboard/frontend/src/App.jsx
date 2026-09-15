import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { ProductsPage } from './pages/ProductsPage.jsx';
import { ProductDetailPage } from './pages/ProductDetailPage.jsx';
import { CartPage } from './pages/CartPage.jsx';
import { CheckoutPage } from './pages/CheckoutPage.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { OrderDetailPage, OrdersPage } from './pages/OrdersPage.jsx';
import { StatusPage } from './pages/StatusPage.jsx';

/** Sends unauthenticated visitors to sign in, remembering where they were going. */
function RequireAuth({ children }) {
  const { isAuthenticated, checking } = useAuth();
  const location = useLocation();

  // Wait for the stored token to be verified, or a reload would bounce a
  // signed-in user to the login page for a moment.
  if (checking) return <div className="card skeleton" style={{ height: 200 }} />;

  if (!isAuthenticated) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return children;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProductsPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="login" element={<AuthPage mode="login" />} />
        <Route path="register" element={<AuthPage mode="register" />} />

        <Route
          path="checkout"
          element={
            <RequireAuth>
              <CheckoutPage />
            </RequireAuth>
          }
        />
        <Route
          path="orders"
          element={
            <RequireAuth>
              <OrdersPage />
            </RequireAuth>
          }
        />
        <Route
          path="orders/:id"
          element={
            <RequireAuth>
              <OrderDetailPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
