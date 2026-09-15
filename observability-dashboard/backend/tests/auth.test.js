import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closePool } from '../src/database/index.js';
import { apiClient, cleanup, databaseSkipReason, registerUser, startTestServer, uniqueEmail } from './helpers.js';

const skip = await databaseSkipReason();

describe('authentication', { skip }, () => {
  let server;
  let baseUrl;
  const request = apiClient(() => baseUrl);
  const createdUserIds = [];

  before(async () => {
    ({ server, baseUrl } = await startTestServer());
  });

  after(async () => {
    await cleanup({ userIds: createdUserIds });
    await new Promise((resolve) => server.close(resolve));
    await closePool();
  });

  describe('POST /api/auth/register', () => {
    it('creates an account and returns a usable token', async () => {
      const email = uniqueEmail();
      const res = await request('POST', '/api/auth/register', {
        body: { email, name: 'Ada Lovelace', password: 'correct-horse-battery-staple' },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.user.email, email);
      assert.equal(res.body.data.tokenType, 'Bearer');
      assert.ok(res.body.data.token);
      createdUserIds.push(res.body.data.user.id);

      // The envelope carries the correlation id, and it matches the header.
      assert.equal(res.body.meta.requestId, res.headers.get('x-request-id'));
    });

    it('never returns the password hash', async () => {
      const user = await registerUser(request);
      createdUserIds.push(user.user.id);

      const serialised = JSON.stringify(user);
      assert.ok(!serialised.includes('password_hash'));
      assert.ok(!serialised.includes('scrypt'));
    });

    it('normalises the email so casing cannot create a duplicate account', async () => {
      const email = uniqueEmail();
      const first = await request('POST', '/api/auth/register', {
        body: { email: email.toUpperCase(), name: 'Case Test', password: 'a-long-enough-password' },
      });

      assert.equal(first.status, 201);
      assert.equal(first.body.data.user.email, email.toLowerCase());
      createdUserIds.push(first.body.data.user.id);

      const second = await request('POST', '/api/auth/register', {
        body: { email, name: 'Case Test', password: 'a-long-enough-password' },
      });
      assert.equal(second.status, 409);
      assert.equal(second.body.error.code, 'EMAIL_ALREADY_REGISTERED');
    });

    it('rejects an invalid payload with every problem at once', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: { email: 'not-an-email', name: '', password: 'short' },
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      const fields = res.body.error.details.issues.map((i) => i.field).sort();
      assert.deepEqual(fields, ['email', 'name', 'password']);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns a token for correct credentials', async () => {
      const { user, password } = await registerUser(request);
      createdUserIds.push(user.id);

      const res = await request('POST', '/api/auth/login', {
        body: { email: user.email, password },
      });

      assert.equal(res.status, 200);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.id, user.id);
    });

    it('rejects a wrong password without revealing whether the account exists', async () => {
      const { user } = await registerUser(request);
      createdUserIds.push(user.id);

      const wrongPassword = await request('POST', '/api/auth/login', {
        body: { email: user.email, password: 'definitely-not-the-password' },
      });
      const unknownAccount = await request('POST', '/api/auth/login', {
        body: { email: uniqueEmail(), password: 'definitely-not-the-password' },
      });

      assert.equal(wrongPassword.status, 401);
      assert.equal(unknownAccount.status, 401);
      // Identical responses: any difference is an account enumeration oracle.
      assert.equal(wrongPassword.body.error.code, unknownAccount.body.error.code);
      assert.equal(wrongPassword.body.error.message, unknownAccount.body.error.message);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the caller when the token is valid', async () => {
      const { user, token } = await registerUser(request);
      createdUserIds.push(user.id);

      const res = await request('GET', '/api/auth/me', { token });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.id, user.id);
    });

    it('rejects a missing token', async () => {
      const res = await request('GET', '/api/auth/me');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('rejects a malformed token', async () => {
      const res = await request('GET', '/api/auth/me', { token: 'not-a-real-jwt' });
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'TOKEN_INVALID');
    });
  });
});
