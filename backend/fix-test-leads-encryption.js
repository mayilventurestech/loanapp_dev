// ONE-TIME SCRIPT
// Fixes the 5 test leads added directly with SQL, whose Aadhar/PAN were
// stored as plain text instead of properly encrypted - same issue we
// fixed before for the test employees/customers. This re-encrypts them
// the same way the app itself would, AND fills in the hash columns
// (lead_aadhar_hash / lead_pan_hash) properly, which we skipped for the
// employee/customer test rows.
//
// HOW TO RUN:
// 1. Save this file directly inside your backend folder
//    (same folder as server.js, db.js, crypto-helper.js) -
//    NOT inside the routes folder.
// 2. Open a terminal in that backend folder and run:
//    node fix-test-leads-encryption.js
// 3. It will print what it updated. You can delete this file afterwards.

require("dotenv").config();
const pool = require("./db");
const { encryptValue, hashValue } = require("./crypto-helper");

// The original plain-text values used when these 5 test leads were created
// Matched by email since that is unique and known ahead of time.
const testLeads = [
  { email: "priya.ramesh.test@example.com", aadhar: "345678912045", pan: "FGHPL5678K" },
  { email: "suresh.babu.test@example.com", aadhar: "456789123056", pan: "GHIQM6789L" },
  { email: "kavitha.elango.test@example.com", aadhar: "567891234067", pan: "HIJRN7890M" },
  { email: "manoj.kumar.test@example.com", aadhar: "678912345078", pan: "IJKSO8901N" },
  { email: "deepa.shankar.test@example.com", aadhar: "789123456089", pan: "JKLTP9012O" },
];

async function run() {
  for (const lead of testLeads) {
    const aadharEncrypted = encryptValue(lead.aadhar);
    const panEncrypted = encryptValue(lead.pan);
    const aadharHash = hashValue(lead.aadhar);
    const panHash = hashValue(lead.pan);

    const result = await pool.query(
      `UPDATE leads
       SET lead_aadhar = $1, lead_pan = $2, lead_aadhar_hash = $3, lead_pan_hash = $4
       WHERE lead_email = $5`,
      [aadharEncrypted, panEncrypted, aadharHash, panHash, lead.email]
    );

    console.log(`${lead.email}: updated ${result.rowCount} row(s).`);
  }

  console.log("Done. You can now check the leads table - Aadhaar/PAN should decrypt correctly.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error fixing test lead encryption:", err);
  process.exit(1);
});