const mockMiddleware = (_req, _res, next) => next && next();

const loadStudentsRouter = () => {
  jest.resetModules();

  jest.doMock("../../middleware/auth", () => ({
    authenticateSuperAdmin: mockMiddleware,
  }));
  jest.doMock("../../middleware/validate", () => (schema) => {
    if (!schema || typeof schema.parse !== "function") {
      throw new Error("Route validation schema must be a Zod schema");
    }

    return mockMiddleware;
  });
  jest.doMock("../../controllers/SuperAdmin/students.controller", () => ({
    getStudentsGlobal: mockMiddleware,
    toggleStudentStatus: mockMiddleware,
    resetStudentPassword: mockMiddleware,
    createStudentGlobal: mockMiddleware,
    bulkImportStudentsGlobal: mockMiddleware,
    getStudentImportJobGlobal: mockMiddleware,
    updateStudentGlobal: mockMiddleware,
    deleteStudentGlobal: mockMiddleware,
    promoteStudentsYearGlobal: mockMiddleware,
  }));

  return require("../../routes/SuperAdmin/students.routes");
};

describe("super-admin student routes", () => {
  it("routes promote-year before the generic student update route", () => {
    const router = loadStudentsRouter();

    const firstPatchMatch = router.stack.find((layer) =>
      layer.route?.methods.patch && layer.regexp.test("/promote-year")
    );

    expect(firstPatchMatch?.route.path).toBe("/promote-year");
  });
});
