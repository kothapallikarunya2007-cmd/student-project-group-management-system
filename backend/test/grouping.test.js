import test from 'node:test';
import assert from 'node:assert/strict';
import { requireApprovedStudents } from '../src/grouping.js';

test('rejects group generation when there are no approved students', () => {
  assert.throws(
    () => requireApprovedStudents([]),
    /No approved student profiles found/
  );
});

test('returns approved students for group generation', () => {
  const students = [{ id: 'student-1' }];
  assert.equal(requireApprovedStudents(students), students);
});
