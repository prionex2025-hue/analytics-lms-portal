describe("adminSearch", () => {
  const loadController = () => {
    jest.resetModules();

    const db = {
      batch: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "batch-1" }])
          .mockResolvedValueOnce([]),
      },
      test: { findMany: jest.fn().mockResolvedValue([]) },
      student: { findMany: jest.fn().mockResolvedValue([]) },
      event: { findMany: jest.fn().mockResolvedValue([]) },
    };

    jest.doMock("../../models", () => ({
      init: jest.fn().mockResolvedValue({ dbClient: db }),
    }));

    const controller = require("../../controllers/Admin/search.controller");
    return { ...controller, db };
  };

  const invoke = (handler, reqOverrides = {}) =>
    new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ statusCode: this.statusCode, payload });
          return this;
        },
      };

      handler(
        {
          query: { q: "algebra" },
          collegeId: "college-1",
          collegeFilter: { collegeId: "college-1" },
          admin: {
            id: "admin-1",
            role: "ADMIN",
            departmentId: "dept-1",
            permissions: ["view_tests", "view_students", "view_batches", "view_events"],
          },
          ...reqOverrides,
        },
        res,
        reject
      );
    });

  it("keeps department admins inside department and batch scope", async () => {
    const { adminSearch, db } = loadController();

    await invoke(adminSearch);

    expect(db.batch.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { collegeId: "college-1", departmentId: "dept-1" },
      select: { id: true },
    }));
    expect(db.test.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            AND: expect.arrayContaining([
              { collegeId: "college-1" },
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { departmentId: "dept-1" },
                  { assignedTo: { in: ["dept-1"] } },
                  { batchId: { in: ["batch-1"] } },
                  { batchAssignments: { some: { batchId: { in: ["batch-1"] } } } },
                ]),
              }),
            ]),
          }),
        ]),
      }),
    }));
    expect(db.student.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { collegeId: "college-1", departmentId: "dept-1" },
        ]),
      }),
    }));
    expect(db.batch.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { collegeId: "college-1", departmentId: "dept-1" },
        ]),
      }),
    }));
  });

  it("does not query or return result types the admin cannot access", async () => {
    const { adminSearch, db } = loadController();

    const result = await invoke(adminSearch, {
      admin: {
        id: "admin-1",
        role: "ADMIN",
        departmentId: "dept-1",
        permissions: [],
      },
    });

    expect(result).toEqual({ statusCode: 200, payload: { data: [] } });
    expect(db.test.findMany).not.toHaveBeenCalled();
    expect(db.student.findMany).not.toHaveBeenCalled();
    expect(db.batch.findMany).not.toHaveBeenCalled();
    expect(db.event.findMany).not.toHaveBeenCalled();
  });
});
