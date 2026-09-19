const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

(async () => {
  const baseUrl = process.env.BASE_URL || "http://localhost:5000";
  const creds = {
    email: requiredEnv("SMOKE_SUPERADMIN_EMAIL"),
    password: requiredEnv("SMOKE_SUPERADMIN_PASSWORD"),
    role: "SUPER_ADMIN",
  };
  const fetchImpl = global.fetch || (await import("node-fetch")).default;

  try {
    const loginRes = await fetchImpl(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    });
    const loginJson = await loginRes.json();
    if (!loginRes.ok) {
      console.error("Login failed", loginJson);
      process.exit(1);
    }

    const token = loginJson.accessToken;
    console.log("Logged in, token length:", String(token || "").length);

    const collegePayload = {
      name: process.env.SMOKE_COLLEGE_NAME || "Smoke Test College",
      code: process.env.SMOKE_COLLEGE_CODE || `SMK${Date.now()}`,
      location: process.env.SMOKE_COLLEGE_LOCATION || "Smoke Test City",
    };
    const collegeRes = await fetchImpl(`${baseUrl}/api/superadmin/colleges`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(collegePayload),
    });
    const collegeJson = await collegeRes.json();
    if (!collegeRes.ok) {
      console.error("Create college failed", collegeJson);
      process.exit(1);
    }
    console.log("Created college:", collegeJson.id || collegeJson);

    const collegeId = collegeJson.id;
    const studentPayload = {
      fullName: process.env.SMOKE_STUDENT_NAME || "Smoke Test Student",
      email: process.env.SMOKE_STUDENT_EMAIL || `smoke-student+${Date.now()}@example.com`,
      enrollNumber: process.env.SMOKE_STUDENT_ENROLL_NUMBER || `SMK${Date.now()}`,
      collegeId,
      department: process.env.SMOKE_STUDENT_DEPARTMENT || "Computer Science",
    };

    const studentRes = await fetchImpl(`${baseUrl}/api/super-admin/students`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(studentPayload),
    });

    const studentJson = await studentRes.json();
    console.log("Create student status:", studentRes.status, studentJson);
    process.exitCode = studentRes.ok ? 0 : 2;
  } catch (error) {
    console.error("Test script error", error);
    process.exit(1);
  }
})();
