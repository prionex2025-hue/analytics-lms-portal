module.exports = {
  testEnvironment: "node",
  // JIT/CI runners are shared; the validation perf smoke tests and heavy
  // integration suites need headroom beyond jest's 5s default.
  testTimeout: 30000,
  // Serial execution keeps DB/Redis-backed suites deterministic and matches
  // the `npm test` invocation (`jest --runInBand`).
  maxWorkers: 1,
  collectCoverageFrom: ["src/**/*.js", "!src/tests/**"],
};