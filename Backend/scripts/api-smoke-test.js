const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

(async () => {
  const baseUrl = process.env.BASE_URL || "http://localhost:5000";
  const superAdminEmail = requiredEnv("SMOKE_SUPERADMIN_EMAIL");
  const superAdminPassword = requiredEnv("SMOKE_SUPERADMIN_PASSWORD");
  const results = [];

  const log = (name, ok, status, body) => {
    results.push({ name, ok, status, body });
    console.log(`${ok ? "OK" : "FAIL"} ${name} -> ${status}`);
    if (!ok && body) console.log("  Body:", JSON.stringify(body).slice(0, 500));
  };

  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: superAdminEmail, password: superAdminPassword, role: "SUPER_ADMIN" }),
    });
    const loginJson = await loginRes.json().catch(() => null);
    log("POST /api/auth/login", loginRes.ok, loginRes.status, loginJson);

    const token = loginJson?.accessToken;
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

    const endpoints = [
      { name: "GET /api/super-admin/colleges", path: "/api/super-admin/colleges" },
      { name: "GET /api/super-admin/dashboard/summary", path: "/api/super-admin/dashboard/summary" },
      { name: "GET /api/super-admin/system/health", path: "/api/super-admin/system/health" },
    ];

    for (const ep of endpoints) {
      try {
        const response = await fetch(baseUrl + ep.path, { headers: { ...authHeaders } });
        const payload = await response.json().catch(() => null);
        log(ep.name, response.ok, response.status, payload);
      } catch (error) {
        log(ep.name, false, "ERR", { message: error.message });
      }
    }
  } catch (error) {
    console.error("Smoke test failed", error);
  }

  console.log("\nSummary:");
  results.forEach((result) => console.log(`${result.ok ? "OK  " : "FAIL"} ${result.name} => ${result.status}`));

  const failed = results.filter((result) => !result.ok);
  process.exit(failed.length === 0 ? 0 : 2);
})();
