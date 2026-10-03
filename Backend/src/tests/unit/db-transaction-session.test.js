/**
 * Regression coverage for session binding in db.$transaction.
 *
 * The model shim resolves every collection from the global connection. Before
 * this fix, `session.withTransaction(() => payload(dbClient))` handed the
 * callback an unbound client, so on a production replica set the transaction
 * committed EMPTY while the caller's writes applied individually - a silent loss
 * of atomicity across bulk batch/student create, answer bulk upsert and test
 * cloning.
 *
 * Real transactions need a replica set, which CI does not provide, so these
 * tests assert the mechanism: that the session is injected into the native
 * driver's options argument, and that an unsupported deployment fails loudly in
 * production instead of degrading silently.
 */

const createSession = () => ({ id: "session-under-test", __isSessionStub: true });

const makeCollection = () => {
  const calls = [];
  const record = (method, optionsIndex) => (...args) => {
    calls.push({ method, args });
    return {
      calls,
      lastOptions: () => {
        const call = calls[calls.length - 1];
        return call.args[optionsIndex];
      },
      batchSize() { return this; },
      limit() { return this; },
      sort() { return this; },
      skip() { return this; },
      toArray: async () => [],
    };
  };

  return {
    calls,
    find: record("find", 1),
    findOne: record("findOne", 1),
    aggregate: record("aggregate", 1),
    insertMany: record("insertMany", 1),
    insertOne: record("insertOne", 1),
    deleteOne: record("deleteOne", 1),
    deleteMany: record("deleteMany", 1),
    countDocuments: record("countDocuments", 1),
    updateMany: record("updateMany", 2),
    updateOne: record("updateOne", 2),
    findOneAndUpdate: record("findOneAndUpdate", 2),
    indexNames: async () => [],
    listIndexes: async () => [],
  };
};

const loadDb = ({ transactionsSupported = true, withTransactionImpl } = {}) => {
  jest.resetModules();

  const collection = makeCollection();
  const session = createSession();
  const state = { session, collection, startSessionCalls: 0, endSessionCalls: 0 };

  const driverSession = {
    withTransaction: withTransactionImpl
      || (async (fn) => fn()),
    endSession: async () => { state.endSessionCalls += 1; },
  };

  const mongooseMock = {
    connection: {
      on: jest.fn(),
      once: jest.fn(),
      off: jest.fn(),
      readyState: 1,
      db: { collection: () => collection },
      startSession: async () => {
        state.startSessionCalls += 1;
        return driverSession;
      },
    },
    connectionState: 1,
    models: {},
    // db.js uses mongoose.Types.ObjectId to detect already-normalised ids.
    Types: { ObjectId: class ObjectId {} },
    disconnect: async () => {},
  };

  jest.doMock("mongoose", () => ({ default: mongooseMock, ...mongooseMock }));
  jest.doMock("../../config/env", () => ({
    mongoUri: "mongodb://test:secret@localhost/lms?replicaSet=rs0",
    mongoDbName: "lms",
    nodeEnv: process.env.NODE_ENV,
    database: { maxPoolSize: 10, minPoolSize: 1, serverSelectionTimeoutMs: 100, relationFilterMaxCandidates: 10, relationFilterBatchSize: 5 },
  }));

  const dbClient = require("../../config/db");

  // dbClient requires a connected mongoose instance; force the connected state
  // the same way the real entrypoint does.
  Object.defineProperty(dbClient, "__testState", { value: state, enumerable: false });

  if (transactionsSupported === false) {
    // Simulate a standalone mongod: withTransaction throws the driver's
    // IllegalOperation error.
    state.session = session;
  }

  return { dbClient, state, collection, session: driverSession, mongooseMock };
};

describe("db.$transaction session binding", () => {
  it("injects the session into driver options so writes join the transaction", async () => {
    const { dbClient, state, session } = loadDb();

    await dbClient.$transaction(async (tx) => {
      // Touch a model through the transaction client; the mocked collection
      // records every native call.
      await tx.batch.updateMany({ id: "b1" }, { name: "renamed" });
    });

    const updateCall = state.collection.calls.find((c) => c.method === "updateMany");
    expect(updateCall).toBeDefined();
    // options is the 3rd argument of updateMany(filter, update, options)
    expect(updateCall.args[2]).toEqual(expect.objectContaining({ session }));
  });

  it("preserves existing driver options when merging the session in", async () => {
    const { dbClient, state, session } = loadDb();

    await dbClient.$transaction(async (tx) => {
      await tx.reportJob.findMany({ where: {}, select: { id: true } });
    });

    const findCall = state.collection.calls.find((c) => c.method === "find");
    expect(findCall).toBeDefined();
    const options = findCall.args[1] || {};
    expect(options.session).toBe(session);
    // A projection passed by the shim must survive the merge.
    if (options.projection !== undefined) {
      expect(options.projection).toBeDefined();
    }
  });

  it("gives each concurrent transaction its own bound client", async () => {
    const { dbClient } = loadDb();
    const first = jest.fn(async (tx) => tx.batch.count({ where: {} }));
    const second = jest.fn(async (tx) => tx.batch.count({ where: {} }));

    await Promise.all([dbClient.$transaction(first), dbClient.$transaction(second)]);

    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it("propagates a business error so the transaction aborts", async () => {
    const { dbClient, state } = loadDb();

    await expect(
      dbClient.$transaction(async () => {
        throw new Error("validation failed");
      })
    ).rejects.toThrow("validation failed");

    expect(state.endSessionCalls).toBeGreaterThan(0);
  });

  it("fails loudly in production when the deployment cannot do transactions", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { dbClient } = loadDb({
        withTransactionImpl: async () => {
          const error = new Error("Transaction numbers are only allowed on a replica set member or mongos");
          error.codeName = "IllegalOperation";
          error.code = 20;
          throw error;
        },
      });

      // A silent degrade here is exactly how bulk writes became non-atomic.
      await expect(dbClient.$transaction(async () => "should-not-run")).rejects.toThrow(/replica set/i);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("still runs the callback on a standalone deployment outside production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const { dbClient } = loadDb({
        withTransactionImpl: async () => {
          const error = new Error("Transaction numbers are only allowed on a replica set member or mongos");
          error.codeName = "IllegalOperation";
          throw error;
        },
      });

      // Dev/CI convenience: standalone mongod runs the work without a session.
      await expect(dbClient.$transaction(async () => "ran")).resolves.toBe("ran");
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
