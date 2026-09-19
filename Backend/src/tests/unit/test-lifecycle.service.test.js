const mockEmitToCollege = jest.fn();
const mockEmitToTestRoom = jest.fn();
const mockCreateAuditLog = jest.fn().mockResolvedValue(null);

jest.mock("../../realtime/socket", () => ({
  emitToCollege: (...args) => mockEmitToCollege(...args),
  emitToTestRoom: (...args) => mockEmitToTestRoom(...args),
}));

jest.mock("../../services/audit.service", () => ({
  createAuditLog: (...args) => mockCreateAuditLog(...args),
}));

const { sweepTestLifecycle } = require("../../services/test-lifecycle.service");

const NOW = new Date("2026-06-01T10:00:00.000Z");

const buildDb = ({ toComplete = [], toGoLive = [] } = {}) => {
  const findMany = jest.fn()
    .mockResolvedValueOnce(toComplete)
    .mockResolvedValueOnce(toGoLive);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  return { test: { findMany, updateMany } };
};

describe("test lifecycle sweep", () => {
  beforeEach(() => {
    mockEmitToCollege.mockClear();
    mockEmitToTestRoom.mockClear();
    mockCreateAuditLog.mockClear();
  });

  it("completes tests whose window has closed and marks completedAt", async () => {
    const db = buildDb({
      toComplete: [{ id: "t1", collegeId: "c1", title: "Ended", status: "LIVE" }],
    });

    const result = await sweepTestLifecycle({ db, now: NOW });

    expect(result.completed).toEqual(["t1"]);
    expect(db.test.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1"] } },
      data: { status: "COMPLETED", completedAt: NOW },
    });
    expect(mockEmitToCollege).toHaveBeenCalledWith("c1", "test_status_change", expect.objectContaining({ testId: "t1", status: "COMPLETED", action: "TEST_COMPLETED" }));
    expect(mockEmitToTestRoom).toHaveBeenCalledWith("t1", "test_status_change", expect.objectContaining({ status: "COMPLETED" }));
    expect(mockCreateAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "TEST_COMPLETED", targetId: "t1" }));
  });

  it("moves published scheduled tests to LIVE once startsAt has passed", async () => {
    const db = buildDb({
      toGoLive: [{ id: "t2", collegeId: "c1", title: "Starting", status: "SCHEDULED" }],
    });

    const result = await sweepTestLifecycle({ db, now: NOW });

    expect(result.wentLive).toEqual(["t2"]);
    expect(db.test.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t2"] } },
      data: { status: "LIVE" },
    });
    expect(mockEmitToCollege).toHaveBeenCalledWith("c1", "test_status_change", expect.objectContaining({ testId: "t2", status: "LIVE", action: "TEST_LIVE" }));
  });

  it("queries completion BEFORE go-live so an already-ended scheduled test never flashes LIVE", async () => {
    const db = buildDb({
      toComplete: [{ id: "t3", collegeId: "c1", title: "Missed window", status: "SCHEDULED" }],
      toGoLive: [],
    });

    await sweepTestLifecycle({ db, now: NOW });

    const [firstCall, secondCall] = db.test.findMany.mock.calls;
    expect(firstCall[0].where.endsAt).toEqual({ lt: NOW });
    expect(secondCall[0].where.startsAt).toEqual({ lte: NOW });
    // Go-live explicitly excludes tests whose endsAt already passed.
    expect(secondCall[0].where.OR).toEqual([{ endsAt: null }, { endsAt: { gte: NOW } }]);
  });

  it("does nothing (and emits nothing) when no transitions are due", async () => {
    const db = buildDb();

    const result = await sweepTestLifecycle({ db, now: NOW });

    expect(result).toEqual({ completed: [], wentLive: [] });
    expect(db.test.updateMany).not.toHaveBeenCalled();
    expect(mockEmitToCollege).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("keeps sweeping when a notification fails", async () => {
    mockEmitToCollege.mockImplementationOnce(() => {
      throw new Error("socket down");
    });
    const db = buildDb({
      toComplete: [
        { id: "t4", collegeId: "c1", title: "A", status: "LIVE" },
        { id: "t5", collegeId: "c1", title: "B", status: "LIVE" },
      ],
    });

    const result = await sweepTestLifecycle({ db, now: NOW });

    expect(result.completed).toEqual(["t4", "t5"]);
    // Second test still notified despite the first throwing.
    expect(mockEmitToCollege).toHaveBeenCalledTimes(2);
  });
});
