export function requireApprovedStudents(students) {
  if (!students.length) {
    throw new Error('No approved student profiles found. Import the roster, have students join with the workspace invite code and their roll numbers, then approve them as Students before generating groups.');
  }

  return students;
}
