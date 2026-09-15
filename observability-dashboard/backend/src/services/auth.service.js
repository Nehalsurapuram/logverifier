import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { PG_ERRORS, query } from '../database/index.js';
import { HttpError } from '../errors/http-error.js';
import { maybeDelay } from '../simulator/delay.js';

const scrypt = promisify(scryptCallback);

// scrypt ships with Node, so there is no native module to compile into the
// Alpine image. N=16384 needs ~16MB per hash, comfortably under the default
// maxmem, and costs enough to make offline guessing expensive.
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keyLength, SCRYPT);

  // Parameters travel with the hash, so they can be raised later without
  // invalidating passwords already stored under the old cost.
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;

  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });

  // Constant time: a plain === leaks how much of the hash matched.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * A real hash to verify against when the email is unknown.
 *
 * Without it, a missing user returns far faster than a wrong password, and that
 * timing difference tells an attacker which emails have accounts.
 */
let decoyHash;
function getDecoyHash() {
  decoyHash ??= hashPassword(randomBytes(24).toString('hex'));
  return decoyHash;
}

export async function registerUser({ email, name, password }, log) {
  await maybeDelay('auth.register', log);

  const passwordHash = await hashPassword(password);

  try {
    const { rows } = await query(
      `INSERT INTO users (email, name, password_hash)
            VALUES ($1, $2, $3)
         RETURNING id, email, name, created_at`,
      [email, name, passwordHash],
    );

    return toPublicUser(rows[0]);
  } catch (err) {
    if (err?.code === PG_ERRORS.UNIQUE_VIOLATION && err.constraint?.includes('email')) {
      throw new HttpError(409, 'An account with that email already exists', {
        code: 'EMAIL_ALREADY_REGISTERED',
        expose: true,
        cause: err,
      });
    }
    throw err;
  }
}

export async function authenticate({ email, password }, log) {
  await maybeDelay('auth.login', log);

  const { rows } = await query(
    `SELECT id, email, name, password_hash, created_at
       FROM users
      WHERE email = $1`,
    [email],
  );

  const user = rows[0];
  const passwordMatches = await verifyPassword(password, user?.password_hash ?? (await getDecoyHash()));

  // One message for both "no such account" and "wrong password": telling them
  // apart is an account enumeration oracle.
  if (!user || !passwordMatches) {
    throw new HttpError(401, 'Invalid email or password', {
      code: 'INVALID_CREDENTIALS',
      expose: true,
    });
  }

  return toPublicUser(user);
}

export async function getUserById(id) {
  const { rows } = await query(
    `SELECT id, email, name, created_at
       FROM users
      WHERE id = $1`,
    [id],
  );

  if (!rows[0]) {
    throw HttpError.notFound('User not found', { code: 'USER_NOT_FOUND' });
  }

  return toPublicUser(rows[0]);
}

export function issueToken(user) {
  const token = jwt.sign({ email: user.email }, config.auth.jwtSecret, {
    subject: user.id,
    expiresIn: config.auth.jwtExpiresIn,
  });

  return { token, tokenType: 'Bearer', expiresIn: config.auth.jwtExpiresIn };
}

/** The only user shape that leaves this module — password_hash never does. */
function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };
}
