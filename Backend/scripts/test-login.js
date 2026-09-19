const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

(async () => {
  try {
    const baseUrl = process.env.BASE_URL || "http://localhost:5000";
    const identifier = requiredEnv("STUDENT_IDENTIFIER");
    const password = requiredEnv("STUDENT_PASSWORD");

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });

    const text = await response.text();
    console.log("STATUS", response.status);
    console.log(text);
    process.exitCode = response.ok ? 0 : 2;
  } catch (error) {
    console.error("ERR", error);
    process.exitCode = 1;
  }
})();
