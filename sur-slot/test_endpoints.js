// Test Name-Based Student Login & Data Persistence across browser history resets
async function testNameBasedStudentLogin() {
  const baseUrl = 'http://localhost:3000';
  console.log('--- Testing Name-Based Student Login & Full Data Persistence ---');

  // 1. Simulate fresh browser session (No previous token / cookies)
  console.log('1. Logging in with Student Name: "Rahul Sharma"...');
  const loginRes = await (await fetch(`${baseUrl}/api/auth/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'Rahul Sharma' })
  })).json();

  console.log('   Login Response Status:', loginRes.status);
  console.log('   Student Loaded:', loginRes.user.name, '| Batch ID:', loginRes.user.batchId, '| Time:', loginRes.user.time);
  if (loginRes.status !== 'enrolled' || loginRes.user.name !== 'Rahul Sharma') {
    throw new Error('Failed to load Rahul Sharma profile by name');
  }

  const token = loginRes.token;

  // 2. Fetch attendance report for all months
  console.log('\n2. Fetching monthly attendance report for Rahul Sharma...');
  const reportRes = await (await fetch(`${baseUrl}/api/students/${loginRes.user.id}/attendance-report?from=2026-08-01&to=2026-08-31`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })).json();

  console.log('   Monthly Summary:', reportRes.summary);
  console.log('   Classes Recorded in DB:', reportRes.classes.length);
  if (!reportRes.summary || reportRes.classes.length === 0) {
    throw new Error('Failed to retrieve monthly classes from database');
  }

  // 3. Test Sibling Group Login by Name: "Sharma Trio"
  console.log('\n3. Logging in with Sibling Group Name: "Sharma Trio"...');
  const groupLogin = await (await fetch(`${baseUrl}/api/auth/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'Sharma Trio' })
  })).json();

  console.log('   Group Login Status:', groupLogin.status);
  console.log('   Group Student Name:', groupLogin.user.name, '| Sibling Members:', groupLogin.user.groupMembers);
  if (!groupLogin.user.groupMembers || groupLogin.user.groupMembers.length === 0) {
    throw new Error('Failed to retrieve sibling group profile by name');
  }

  console.log('\n🎉 ALL NAME-BASED STUDENT LOGIN & PERMANENT PERSISTENCE TESTS PASSED!');
}

testNameBasedStudentLogin().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
