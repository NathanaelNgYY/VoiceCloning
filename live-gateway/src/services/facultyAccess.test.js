import assert from 'node:assert/strict';
import test from 'node:test';

import { enforceFacultyAccess, isFacultyRequest } from './facultyAccess.js';

const req = (site) => ({ headers: { 'X-VCS-Site': site } });

test('faculty request is selected by the CloudFront-stamped site header', () => {
  assert.equal(isFacultyRequest(req('faculty')), true);
  assert.equal(isFacultyRequest(req('lectures')), false);
  assert.equal(isFacultyRequest({ headers: {} }), false);
});

test('faculty permits only an exact configured email domain', () => {
  const domains = ['staff.main.ntu.edu.sg', 'assoc.main.ntu.edu.sg'];
  assert.doesNotThrow(() => enforceFacultyAccess(
    { email: 'lecturer@staff.main.ntu.edu.sg' }, req('faculty'), domains,
  ));
  assert.throws(() => enforceFacultyAccess(
    { email: 'student@student.main.ntu.edu.sg' }, req('faculty'), domains,
  ), (error) => error.code === 'domain_not_allowed');
  assert.throws(() => enforceFacultyAccess(
    { email: 'lecturer@evilstaff.main.ntu.edu.sg' }, req('faculty'), domains,
  ), (error) => error.code === 'domain_not_allowed');
});

test('non-faculty requests retain the main allowlist decision', () => {
  assert.doesNotThrow(() => enforceFacultyAccess(
    { email: 'student@student.main.ntu.edu.sg' }, req('lectures'), ['staff.main.ntu.edu.sg'],
  ));
});
