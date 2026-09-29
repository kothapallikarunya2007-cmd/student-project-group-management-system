const normalizeHeader = value => String(value)
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const aliases = {
  rollNumber: ['rollnumber', 'rollno', 'registernumber', 'registrationnumber', 'regno'],
  name: ['name', 'studentname'],
  cgpa: ['cgpa'],
  section: ['section']
};

export function parseRosterRows(rows) {
  if (!rows.length) {
    throw new Error('The first worksheet is empty. Add a header row and student records.');
  }

  const headers = Object.keys(rows[0]);
  const columns = Object.fromEntries(
    Object.entries(aliases).map(([field, names]) => [
      field,
      headers.find(header => names.includes(normalizeHeader(header)))
    ])
  );

  if (!columns.rollNumber) {
    throw new Error('Could not find a roll number column. Use a header such as "roll_number", "Roll Number", or "Roll No".');
  }

  let skipped = 0;
  const records = [];

  for (const row of rows) {
    const rawRollNumber = row[columns.rollNumber];
    const rollNumber = rawRollNumber == null ? '' : String(rawRollNumber).trim();
    if (!rollNumber) {
      skipped++;
      continue;
    }

    records.push({
      rollNumber,
      name: columns.name ? String(row[columns.name] ?? '').trim() : '',
      cgpa: columns.cgpa ? row[columns.cgpa] ?? null : null,
      section: columns.section ? row[columns.section] ?? null : null
    });
  }

  if (!records.length) {
    throw new Error('No student rows contain a roll number. Check the worksheet data below the header row.');
  }

  return { records, skipped };
}
