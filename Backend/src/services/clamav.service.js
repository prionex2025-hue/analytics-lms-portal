const fs = require("fs");
const net = require("net");

const env = require("../config/env");
const { ApiError } = require("../utils/http");

const CLAMAV_CHUNK_SIZE_BYTES = 64 * 1024;

const writeSocket = (socket, chunk) =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("error", onError);
      socket.off("drain", onDrain);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };

    socket.once("error", onError);
    if (socket.write(chunk)) {
      cleanup();
      resolve();
    } else {
      socket.once("drain", onDrain);
    }
  });

const waitForSocketConnect = (socket) =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });

const createResponseWaiter = (socket, timeoutMs) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const finish = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim());
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      const response = Buffer.concat(chunks).toString("utf8");
      if (/\b(OK|FOUND|ERROR|PONG)\b/.test(response)) {
        finish();
      }
    };
    const onEnd = () => finish();
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("ClamAV request timed out"));
    };
    const timer = setTimeout(onTimeout, timeoutMs);

    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });

const sendClamAVCommand = async ({ command, streamPath }) => {
  const socket = net.createConnection({
    host: env.uploadScan.host,
    port: env.uploadScan.port,
  });
  socket.setTimeout(env.uploadScan.timeoutMs);

  try {
    await waitForSocketConnect(socket);
    const responsePromise = createResponseWaiter(socket, env.uploadScan.timeoutMs);
    await writeSocket(socket, Buffer.from(`z${command}\0`));

    if (streamPath) {
      for await (const chunk of fs.createReadStream(streamPath, { highWaterMark: CLAMAV_CHUNK_SIZE_BYTES })) {
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        await writeSocket(socket, size);
        await writeSocket(socket, chunk);
      }
      await writeSocket(socket, Buffer.alloc(4));
    }

    const response = await responsePromise;
    socket.end();
    return response;
  } catch (error) {
    socket.destroy();
    throw error;
  }
};

const pingClamAV = async () => {
  if (!env.uploadScan.enabled) {
    return {
      enabled: false,
      reachable: false,
      status: "disabled",
    };
  }

  try {
    const response = await sendClamAVCommand({ command: "PING" });
    const reachable = /\bPONG\b/.test(response);
    return {
      enabled: true,
      reachable,
      status: reachable ? "ok" : "unexpected_response",
      response,
    };
  } catch (error) {
    return {
      enabled: true,
      reachable: false,
      status: "down",
      error: error?.message || "ClamAV unavailable",
    };
  }
};

const scanFileForThreats = async (filePath) => {
  if (!env.uploadScan.enabled) {
    return {
      status: "skipped",
    };
  }

  let response;
  try {
    response = await sendClamAVCommand({
      command: "INSTREAM",
      streamPath: filePath,
    });
  } catch (error) {
    throw new ApiError(
      503,
      "Upload malware scan service is unavailable",
      { scanner: "clamav", error: error?.message || "unavailable" },
      "UPLOAD_SCAN_UNAVAILABLE"
    );
  }

  if (/\bFOUND\b/.test(response)) {
    throw new ApiError(400, "Uploaded file failed malware scan", { scanner: "clamav" }, "UPLOAD_MALWARE_DETECTED");
  }

  if (/\bOK\b/.test(response)) {
    return {
      status: "clean",
      response,
    };
  }

  throw new ApiError(
    503,
    "Upload malware scan returned an unexpected response",
    { scanner: "clamav", response },
    "UPLOAD_SCAN_UNAVAILABLE"
  );
};

module.exports = {
  pingClamAV,
  scanFileForThreats,
};
