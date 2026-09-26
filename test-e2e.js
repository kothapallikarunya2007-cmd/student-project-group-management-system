async function runE2ETests() {
  const BASE = 'http://localhost:4000/api';
  console.log('--- Starting End-to-End Workflow Tests ---');

  // Helper fetcher
  async function req(path, options = {}, token = null) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, { ...options, headers });
    const isJson = res.headers.get('content-type')?.includes('json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      throw new Error(`[${res.status} ${path}] ${data.error || JSON.stringify(data)}`);
    }
    return data;
  }

  // 1. Health check & Supabase connection status
  console.log('1. Testing Health & Supabase status...');
  const health = await req('/health');
  console.log('   Health status:', health.status, '| DB Mode:', health.mode);
  console.log('   Supabase configured:', health.supabase.configured, '| URL:', health.supabase.url);

  // 2. HOD Signup
  console.log('2. Testing HOD Signup...');
  const hodEmail = `hod_${Date.now()}@university.edu`;
  const hodSignup = await req('/auth/hod-signup', {
    method: 'POST',
    body: JSON.stringify({
      email: hodEmail,
      password: 'SecurePassword123!',
      workspaceName: 'Computer Science Dept'
    })
  });
  const hodToken = hodSignup.token;
  const workspaceHandle = hodSignup.workspace.handle_code;
  console.log('   HOD created successfully!');
  console.log('   Workspace handle code:', workspaceHandle);

  // 3. Verify /api/me for HOD
  console.log('3. Testing /api/me...');
  const me = await req('/me', {}, hodToken);
  console.log('   Logged in user:', me.email, '| Role:', me.role, '| Workspace:', me.workspace_name);

  // 4. Student Join Request
  console.log('4. Testing Student Join Request...');
  const studentEmail = `student_${Date.now()}@student.edu`;
  const studentJoin = await req('/auth/join', {
    method: 'POST',
    body: JSON.stringify({
      email: studentEmail,
      password: 'StudentPass123!',
      handleCode: workspaceHandle,
      rollNumber: 'CS2026-001'
    })
  });
  console.log('   Student request result:', studentJoin.message);

  // 5. Faculty Join Request
  console.log('5. Testing Faculty Join Request...');
  const facultyEmail = `prof_${Date.now()}@university.edu`;
  const facultyJoin = await req('/auth/join', {
    method: 'POST',
    body: JSON.stringify({
      email: facultyEmail,
      password: 'FacultyPass123!',
      handleCode: workspaceHandle
    })
  });
  console.log('   Faculty request result:', facultyJoin.message);

  // 6. HOD Overview & Approvals
  console.log('6. Testing HOD Overview & Approving Requests...');
  const overview = await req('/hod/overview', {}, hodToken);
  console.log('   Pending requests count:', overview.requests.length);

  const studentReq = overview.requests.find(r => r.email === studentEmail);
  const facultyReq = overview.requests.find(r => r.email === facultyEmail);

  if (!studentReq || !facultyReq) {
    throw new Error('Pending requests not found in HOD overview');
  }

  // Approve Faculty
  await req(`/hod/requests/${facultyReq.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'approve', role: 'FACULTY' })
  }, hodToken);
  console.log('   Approved faculty:', facultyEmail);

  // Approve Student
  await req(`/hod/requests/${studentReq.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'approve', role: 'STUDENT' })
  }, hodToken);
  console.log('   Approved student:', studentEmail);

  // 7. Save Setup Config
  console.log('7. Testing HOD Setup Config...');
  const setupConfig = await req('/hod/config', {
    method: 'PUT',
    body: JSON.stringify({
      totalStudents: 1,
      numGroups: 1,
      numFaculty: 1,
      teamSize: 1,
      segregationBasis: 'CGPA'
    })
  }, hodToken);
  console.log('   Setup saved. numGroups:', setupConfig.num_groups, '| teamSize:', setupConfig.team_size);

  // 8. Generate Groups
  console.log('8. Testing Group Generation...');
  const genResult = await req('/hod/generate-groups', {
    method: 'POST'
  }, hodToken);
  console.log('   Group generation result:', genResult.message, '| Students placed:', genResult.students);

  // 9. Faculty Login
  console.log('9. Testing Faculty Login...');
  const facultyLogin = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: facultyEmail,
      password: 'FacultyPass123!'
    })
  });
  const facultyToken = facultyLogin.token;
  console.log('   Faculty logged in successfully!');

  // 10. Faculty Views Groups & Updates Topic
  console.log('10. Testing Faculty Group Management...');
  const facultyGroups = await req('/faculty/groups', {}, facultyToken);
  console.log('   Faculty groups found:', facultyGroups.length);
  if (!facultyGroups.length) throw new Error('No groups found for faculty');
  const group = facultyGroups[0];
  console.log('   Group ID:', group.id, '| CGPA Band:', group.cgpa_band, '| Status:', group.status);

  // Set topic
  const updatedGroup = await req(`/faculty/groups/${group.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ topic: 'Autonomous Drone Navigation System' })
  }, facultyToken);
  console.log('   Topic set to:', updatedGroup.topic);

  // Lock group
  const lockResult = await req(`/faculty/groups/${group.id}/lock`, {
    method: 'POST'
  }, facultyToken);
  console.log('   Group locked status:', lockResult.ok ? 'SUCCESS' : 'FAILED');

  // 11. Faculty Creates Task & Assigns Subtask
  console.log('11. Testing Task & Subtask Creation...');
  const task = await req(`/faculty/groups/${group.id}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Milestone 1: Architecture & Sensor Integration',
      description: 'Design ROS2 node architecture and integrate LiDAR.'
    })
  }, facultyToken);
  console.log('   Task created:', task.title, '| ID:', task.id);

  const studentMember = group.members[0];
  if (!studentMember) throw new Error('No student found in group members');

  const subtask = await req(`/faculty/tasks/${task.id}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Implement Kalman Filter Node',
      studentId: studentMember.id,
      dueDate: '2026-10-15'
    })
  }, facultyToken);
  console.log('   Subtask assigned to student:', subtask.title, '| Status:', subtask.status);

  // 12. Student Login & Dashboard
  console.log('12. Testing Student Login & Dashboard...');
  const studentLogin = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: studentEmail,
      password: 'StudentPass123!'
    })
  });
  const studentToken = studentLogin.token;
  console.log('   Student logged in successfully!');

  const dashboard = await req('/student/dashboard', {}, studentToken);
  console.log('   Student group:', dashboard.group?.topic);
  console.log('   Student assigned subtasks:', dashboard.subtasks?.length);
  console.log('   Student notifications:', dashboard.notifications?.length);

  // 13. Student Marks Subtask Done
  console.log('13. Testing Subtask Completion...');
  const markDone = await req(`/student/subtasks/${subtask.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DONE' })
  }, studentToken);
  console.log('   Subtask marked DONE status:', markDone.ok ? 'SUCCESS' : 'FAILED');

  // Verify updated student dashboard
  const updatedDashboard = await req('/student/dashboard', {}, studentToken);
  console.log('   Updated subtask status in dashboard:', updatedDashboard.subtasks[0]?.status);

  console.log('\n=============================================');
  console.log('🎉 ALL END-TO-END WORKFLOWS PASSED 100%! 🎉');
  console.log('=============================================');
}

runE2ETests().catch(err => {
  console.error('\n❌ Test failed with error:', err.message);
  process.exit(1);
});
