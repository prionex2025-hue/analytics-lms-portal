// Process lifecycle flags shared between the HTTP layer and server.js.
// Once shutdown starts, readiness reports 503 so the load balancer stops
// routing new requests here while in-flight ones finish.
let shuttingDown = false;

const markShuttingDown = () => {
  shuttingDown = true;
};

const isShuttingDown = () => shuttingDown;

module.exports = { markShuttingDown, isShuttingDown };
