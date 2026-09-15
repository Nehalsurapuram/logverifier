import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBanner } from '../components/ErrorBanner.jsx';

export function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';

  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const fieldErrors = error?.fieldIssues ?? {};

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (isRegister) await register(form);
      else await login({ email: form.email, password: form.password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>{isRegister ? 'Create an account' : 'Sign in'}</h1>
      <p className="lede">
        {isRegister
          ? 'Registering signs you in straight away.'
          : 'You need an account to place an order.'}
      </p>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <form className="card" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            aria-invalid={Boolean(fieldErrors.email)}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          {fieldErrors.email ? <div className="error">{fieldErrors.email}</div> : null}
        </div>

        {isRegister ? (
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              autoComplete="name"
              value={form.name}
              aria-invalid={Boolean(fieldErrors.name)}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            {fieldErrors.name ? <div className="error">{fieldErrors.name}</div> : null}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={form.password}
            aria-invalid={Boolean(fieldErrors.password)}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          {fieldErrors.password ? (
            <div className="error">{fieldErrors.password}</div>
          ) : isRegister ? (
            <div className="hint">At least 10 characters. Length beats punctuation.</div>
          ) : null}
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Working…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
        {isRegister ? (
          <>
            Already have an account?{' '}
            <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
          </>
        ) : (
          <>
            No account yet?{' '}
            <Link to={`/register?next=${encodeURIComponent(next)}`}>Create one</Link>
          </>
        )}
      </p>
    </div>
  );
}
