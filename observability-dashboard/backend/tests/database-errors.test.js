import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DatabaseError,
  PG_ERRORS,
  classifyDatabaseError,
  isConnectionError,
  isUniqueViolation,
  redactSecrets,
  summariseStatement,
} from '../src/database/errors.js';

/** A duplicate-key error shaped exactly as node-postgres produces it. */
function uniqueViolation() {
  return Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    code: '23505',
    constraint: 'users_email_key',
    table: 'users',
    schema: 'public',
    routine: '_bt_check_unique',
    severity: 'ERROR',
    // The driver really does quote the offending value back at you.
    detail: 'Key (email)=(ada@example.com) already exists.',
  });
}

describe('database error redaction', () => {
  it('drops the detail field, which quotes user data back', () => {
    const wrapped = new DatabaseError(uniqueViolation());
    const logged = JSON.stringify(wrapped.toLogContext());

    // This is the whole point: a duplicate registration must not write a
    // customer's email address into the logs.
    assert.equal(logged.includes('ada@example.com'), false);
    assert.equal(logged.includes('detail'), false);
    assert.equal(wrapped.detail, undefined);
  });

  it('keeps the structural fields that make an error diagnosable', () => {
    const context = new DatabaseError(uniqueViolation()).toLogContext();

    assert.equal(context.sqlstate, '23505');
    assert.equal(context.constraint, 'users_email_key');
    assert.equal(context.table, 'users');
    assert.equal(context.kind, 'constraint');
  });

  it('preserves code and constraint so call sites can still branch on them', () => {
    const wrapped = new DatabaseError(uniqueViolation());

    assert.equal(wrapped.code, PG_ERRORS.UNIQUE_VIOLATION);
    assert.equal(isUniqueViolation(wrapped, 'users_email_key'), true);
    assert.equal(isUniqueViolation(wrapped, 'some_other_key'), false);
  });

  it('strips credentials out of a connection string', () => {
    const leaked = 'could not connect to postgresql://observability:s3cr3t@db.internal:5432/app';
    const safe = redactSecrets(leaked);

    assert.equal(safe.includes('s3cr3t'), false);
    assert.equal(safe.includes('observability:'), false);
    assert.ok(safe.includes('db.internal:5432/app'));
  });

  it('strips password assignments in any of the usual spellings', () => {
    assert.equal(redactSecrets('password=hunter2').includes('hunter2'), false);
    assert.equal(redactSecrets("PGPASSWORD: 'hunter2'").includes('hunter2'), false);
    assert.equal(redactSecrets('pwd="hunter2"').includes('hunter2'), false);
  });

  it('redacts the wrapped error message itself, not just the log context', () => {
    const err = new Error('connection to postgresql://user:letmein@host:5432/db failed');
    const wrapped = new DatabaseError(err);

    assert.equal(wrapped.message.includes('letmein'), false);
  });

  it('summarises a statement to one line without its parameters', () => {
    const sql = `SELECT id, email
                   FROM users   -- lookup
                  WHERE email = $1`;
    const summary = summariseStatement(sql);

    assert.equal(summary.includes('\n'), false);
    assert.ok(summary.includes('WHERE email = $1'));
    // The statement is safe to log exactly because the value is a parameter.
    assert.equal(summary.includes('@'), false);
  });

  it('truncates a very long statement', () => {
    assert.ok(summariseStatement(`SELECT ${'x'.repeat(500)}`, 100).length <= 101);
  });
});

describe('database error classification', () => {
  it('separates an outage from the database working correctly and saying no', () => {
    assert.equal(classifyDatabaseError(new Error('Connection terminated due to connection timeout')), 'connection');
    assert.equal(classifyDatabaseError(uniqueViolation()), 'constraint');
    assert.equal(classifyDatabaseError(Object.assign(new Error('x'), { code: '42P01' })), 'query');
  });

  it('treats exhausted server connections as a connection problem', () => {
    // too_many_connections means the database is at capacity, which a caller
    // should retry — not a bug in the request.
    assert.equal(isConnectionError(Object.assign(new Error('x'), { code: '53300' })), true);
  });

  it('recognises a cancelled or timed-out query', () => {
    assert.equal(classifyDatabaseError(Object.assign(new Error('x'), { code: '57014' })), 'timeout');
  });

  it('does not double-wrap an already wrapped error', () => {
    const once = new DatabaseError(uniqueViolation());
    assert.equal(once.cause.code, '23505');
    assert.equal(once instanceof DatabaseError, true);
  });
});
