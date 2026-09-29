import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterRows } from '../src/roster.js';

test('parses common Excel roster header formats', () => {
  const result = parseRosterRows([
    { 'Roll No.': 'CS001', 'Student Name': 'Ada Lovelace', CGPA: 9.2, SECTION: 'A' }
  ]);

  assert.deepEqual(result, {
    records: [{ rollNumber: 'CS001', name: 'Ada Lovelace', cgpa: 9.2, section: 'A' }],
    skipped: 0
  });
});

test('trims roll numbers and reports rows without one', () => {
  const result = parseRosterRows([
    { roll_number: ' CS001 ', name: 'Ada' },
    { roll_number: null, name: 'No roll number' }
  ]);

  assert.equal(result.records[0].rollNumber, 'CS001');
  assert.equal(result.skipped, 1);
});

test('explains when the worksheet has no supported roll number column', () => {
  assert.throws(
    () => parseRosterRows([{ 'Student ID': 'CS001', Name: 'Ada' }]),
    /Could not find a roll number column/
  );
});

test('explains when the worksheet has no student records', () => {
  assert.throws(
    () => parseRosterRows([{ 'Roll Number': null, Name: 'Ada' }]),
    /No student rows contain a roll number/
  );
});
