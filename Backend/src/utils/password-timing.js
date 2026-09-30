const bcrypt = require("bcrypt");

// Hash with the same cost factor as real password hashes (10). Comparing
// against it when no account matches makes "unknown account" responses take
// as long as "wrong password" ones, so login latency does not reveal which
// student IDs / emails exist.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-credential", 10);

const compareAgainstDummyHash = async (password) => {
  await bcrypt.compare(String(password || ""), DUMMY_PASSWORD_HASH);
  return false;
};

module.exports = { compareAgainstDummyHash };
