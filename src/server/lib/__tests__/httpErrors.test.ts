import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendServerError } from '../httpErrors.js';
import { AccessDenied } from '../access.js';

function fakeRes() {
  const out: { status?: number; body?: any } = {};
  const res: any = {
    headersSent: false,
    req: { method: 'GET', path: '/x' },
    getHeader: () => 'req-123',
    status(code: number) { out.status = code; return res; },
    json(body: any) { out.body = body; return res; },
  };
  return { res, out };
}

test('500 responses hide the underlying error and return the request id', () => {
  const { res, out } = fakeRes();
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), { code: '23505' });
  sendServerError(res, pgError);
  assert.equal(out.status, 500);
  assert.deepEqual(out.body, { error: 'Internal server error', requestId: 'req-123' });
  assert.ok(!JSON.stringify(out.body).includes('users_email_key'));
});

test('AccessDenied maps to its own status and message', () => {
  for (const [err, status] of [[new AccessDenied(), 403], [new AccessDenied(404, 'Note not found'), 404]] as const) {
    const { res, out } = fakeRes();
    sendServerError(res, err);
    assert.equal(out.status, status);
    assert.deepEqual(out.body, { error: err.message });
  }
});
