// ONE-TIME SCRIPT
// Fixes the 5 customers added directly with SQL, whose Aadhar/PAN were
// stored as plain text instead of properly encrypted. This re-encrypts
// them the same way the app itself would, so they display correctly
// once employees.js/customers.js are updated.
//
// HOW TO RUN:
// 1. Save this file directly inside your backend folder
//    (same folder as server.js, db.js, crypto-helper.js) -
//    NOT inside the routes folder.
// 2. Open a terminal in that backend folder and run:
//    node fix-test-customer-encryption.js
// 3. It will print what it updated. You can delete this file afterwards.

require("dotenv").config();
const pool = require("./db");
const { encryptValue } = require("./crypto-helper");

// The original plain-text values used when these 5 test customers were created
// Matched by email since that is unique and known ahead of time.
const testCustomers = [
  { email: "senthilkuamr@gmail.com", aadhar: "111122223333", pan: "AAAPS1111Q" },
  { email: "preethiragu@gmail.com", aadhar: "222233334444", pan: "BBBPR2222R" },
  { email: "sugumar@gmail.com", aadhar: "333344445555", pan: "CCCPS3333S" },
  { email: "ganesh.babu@gmail.com", aadhar: "444455556666", pan: "DDDPG4444T" },
  { email: "meena.devi@gmail.com", aadhar: "555566667777", pan: "EEEPM5555U" },
];

async function run() {
  for (const cust of testCustomers) {
    const aadharEncrypted = encryptValue(cust.aadhar).toString("base64");
    const panEncrypted = encryptValue(cust.pan).toString("base64");

    const result = await pool.query(
      `UPDATE customer
       SET cust_aadhar = $1, cust_pan = $2
       WHERE cust_email = $3`,
      [aadharEncrypted, panEncrypted, cust.email]
    );

    console.log(`${cust.email}: updated ${result.rowCount} row(s).`);
  }

  console.log("Done. You can now restart the backend and check the Customer list.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error fixing test customer encryption:", err);
  process.exit(1);
});