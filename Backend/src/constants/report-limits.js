// Most tests a single generated report may cover. The multi-test PDF lays the
// selected tests out as columns of a student × test table, which stops being
// readable on an A4 page beyond this.
const MAX_REPORT_TESTS = 10;

module.exports = { MAX_REPORT_TESTS };
