#!/usr/bin/env node
/*
 * One-off bulk student deletion by email.
 *
 * Mirrors the Super Admin "delete student" behavior exactly:
 *   - deletes ONLY the student document (no cascade of submissions/violations)
 *   - revokes the student's refresh tokens (DB + auth cache)
 *   - writes a SUPER_ADMIN_DELETE_STUDENT audit log per student
 *
 * SAFE BY DEFAULT: without --confirm it runs a DRY RUN and deletes nothing.
 *
 * Usage (run on the server, inside the API container):
 *   node scripts/mongo/delete-students-by-email.js              # dry run / report
 *   node scripts/mongo/delete-students-by-email.js --confirm    # actually delete
 *   node scripts/mongo/delete-students-by-email.js --confirm --force   # ignore batch guard
 *
 * The batch guard skips any matched student whose batches do NOT include
 * EXPECTED_BATCH, unless --force is passed. This protects against an email
 * accidentally matching a student outside the intended batch.
 */

require("dotenv").config();

const dbClient = require("../../src/config/db");
const { invalidateRefreshTokenRecord } = require("../../src/services/refresh-token-cache.service");
const { bumpPrincipalTokenVersion } = require("../../src/services/auth-revocation.service");
const { createAuditLog } = require("../../src/services/audit.service");

// Batch: "MEC THIRD YR BATCH 3 - AUG 2026" — 42 unique students.
const EXPECTED_BATCH = "MEC THIRD YR BATCH 3 - AUG 2026";

const EMAILS = [
  "balapennachi@gmail.com",
  "ganeshrajesh978@gmail.com",
  "kesavarthini.1082007@gmail.com",
  "yuvasri867@gmail.com",
  "saranyasam2007@gmail.com",
  "yasminsameera2007@gmail.com",
  "sundar.s0022@gmail.com",
  "razackmohamed80@gmail.com",
  "udhayakumar200005@gmail.com",
  "vidhyasivakumar485@gmail.com",
  "poojaprasana19@gmail.com",
  "sarumathimurugan2002@gmail.com",
  "saravanansaravanan80232@gmail.com",
  "kamaleshksv@gmail.com",
  "kelakiya152@gmail.com",
  "subakshaasubakshaa@gmail.com",
  "jana8300792747@gmail.com",
  "gomathimeerag@gmail.com",
  "pm8597523@gmail.com",
  "24csbs9balamurugan@mailamengg.com",
  "swathikannan8686@gmail.com",
  "blsrvnb@gmail.com",
  "mugil4640@gmail.com",
  "nivethasanthoshkumar2006@gmail.com",
  "aathilahamed2087@gmail.com",
  "harinib2098@gmail.com",
  "sumathisiva712@gmail.com",
  "bavana937@gmail.com",
  "eggashokkumar@gmail.com",
  "koschikabaskaran@gmail.com",
  "mohammedaadil000786@gmail.com",
  "kavimurugan192007@gmail.com",
  "santhoshsivakumar2105@gmail.com",
  "nandusuba870@gmail.com",
  "jamunaneelakandan4@gmail.com",
  "prabavathy713@gmail.com",
  "abinayaabinaya1700@gmail.com",
  "swathi66477@gmail.com",
  "psunilkaran2711@gmail.com",
  "ashmoosali123@gmail.com",
  "mahanithya2025@gmail.com",
  "gsubasri2428@gmail.com",
].map((e) => e.trim().toLowerCase());

const revokeStudentRefreshTokens = async (db, studentId) => {
  try {
    await bumpPrincipalTokenVersion(db, "student", studentId);
  } catch (err) {
    console.warn(`  ! token-version bump failed (non-fatal): ${err.message}`);
  }
  const activeTokens = await db.studentRefreshToken.findMany({
    where: { userId: studentId, revokedAt: null },
  });
  await db.studentRefreshToken.updateMany({
    where: { userId: studentId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await Promise.all(
    activeTokens.map((record) =>
      invalidateRefreshTokenRecord("student", record).catch((err) =>
        console.warn(`  ! refresh-token cache invalidation failed (non-fatal): ${err.message}`),
      ),
    ),
  );
};

const main = async () => {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const force = args.includes("--force");
  const db = dbClient;

  const uniqueEmails = [...new Set(EMAILS)];
  console.log(`\nTarget DB: ${process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/\/\/[^@]*@/, "//***:***@") : "(unset)"}`);
  console.log(`Mode: ${confirm ? "DELETE (--confirm)" : "DRY RUN (no changes)"}${force ? " [--force: batch guard OFF]" : ""}`);
  console.log(`Emails in list: ${uniqueEmails.length}\n`);

  // Resolve each email -> student
  const matched = [];
  const notFound = [];
  for (const email of uniqueEmails) {
    const student = await db.student.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (student) matched.push({ email, student });
    else notFound.push(email);
  }

  // Resolve batch names for display + guard
  const allBatchIds = [
    ...new Set(matched.flatMap(({ student }) => student.batchIds || [])),
  ];
  const batchNameById = {};
  for (const bid of allBatchIds) {
    const batch = await db.batch.findUnique({ where: { id: bid } });
    if (batch) batchNameById[bid] = batch.name;
  }
  const batchNamesOf = (student) =>
    (student.batchIds || []).map((bid) => batchNameById[bid] || `<${bid}>`);

  console.log("=== MATCHED STUDENTS ===");
  const toDelete = [];
  const guarded = [];
  for (const { email, student } of matched) {
    const names = batchNamesOf(student);
    const inExpected = names.includes(EXPECTED_BATCH);
    const flag = inExpected ? "" : "  <== BATCH MISMATCH";
    console.log(
      `  ${email}\n    ${student.fullName} | enroll=${student.enrollNumber || "-"} | ${student.department?.name || student.departmentId || "-"} | status=${student.lifecycleStatus}\n    batches=[${names.join(", ")}]${flag}`,
    );
    if (inExpected || force) toDelete.push({ email, student });
    else guarded.push({ email, student });
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Matched:            ${matched.length}`);
  console.log(`  Not found:          ${notFound.length}`);
  if (notFound.length) notFound.forEach((e) => console.log(`      - ${e}`));
  console.log(`  Batch-guard skips:  ${guarded.length}${guarded.length ? "  (pass --force to include)" : ""}`);
  console.log(`  Will delete:        ${toDelete.length}`);

  if (!confirm) {
    console.log(`\nDRY RUN complete. No records were changed.`);
    console.log(`Re-run with --confirm to delete the ${toDelete.length} student(s) above.\n`);
    process.exit(0);
  }

  console.log(`\n=== DELETING ${toDelete.length} STUDENT(S) ===`);
  let deleted = 0;
  const failures = [];
  for (const { email, student } of toDelete) {
    try {
      await db.student.delete({ where: { id: student.id } });
      await revokeStudentRefreshTokens(db, student.id);
      await createAuditLog({
        action: "SUPER_ADMIN_DELETE_STUDENT",
        targetType: "STUDENT",
        targetId: student.id,
        collegeId: student.collegeId,
        superAdminId: null,
        beforeState: student,
        afterState: null,
      });
      deleted += 1;
      console.log(`  deleted: ${email} (${student.fullName})`);
    } catch (err) {
      failures.push({ email, error: err.message });
      console.error(`  FAILED:  ${email} -> ${err.message}`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Deleted: ${deleted}/${toDelete.length}`);
  if (failures.length) {
    console.log(`  Failures: ${failures.length}`);
    failures.forEach((f) => console.log(`      - ${f.email}: ${f.error}`));
  }
  process.exit(failures.length ? 1 : 0);
};

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
