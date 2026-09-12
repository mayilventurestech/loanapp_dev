// ONE-TIME SCRIPT
// Fixes the 5 employees (EMP024-EMP028) that were added directly with SQL,
// whose Aadhar/PAN were stored as plain text instead of properly encrypted.
// This re-encrypts them the same way the app itself would, so they display
// correctly once the updated employees.js route is in place.
//
// HOW TO RUN:
// 1. Save this file directly inside your backend folder
//    (same folder as server.js, db.js, crypto-helper.js) -
//    NOT inside the routes folder.
// 2. Open a terminal in that backend folder and run:
//    node fix-test-employee-encryption.js
// 3. It will print what it updated. You can delete this file afterwards.

require("dotenv").config();
const pool = require("./db");
const { encryptValue } = require("./crypto-helper");

// The original plain-text values used when these 5 test employees were created
const testEmployees = [
  { emp_id: "EMP024", aadhar: "234567891023", pan: "ABCPK1234F" },
  { emp_id: "EMP025", aadhar: "345678912034", pan: "BCDKL2345G" },
  { emp_id: "EMP026", aadhar: "456789123045", pan: "CDEAR3456H" },
  { emp_id: "EMP027", aadhar: "567891234056", pan: "DEFDS4567I" },
  { emp_id: "EMP028", aadhar: "678912345067", pan: "EFGVR5678J" },
];

async function run() {
  for (const emp of testEmployees) {
    const aadharEncrypted = encryptValue(emp.aadhar).toString("base64");
    const panEncrypted = encryptValue(emp.pan).toString("base64");

    const result = await pool.query(
      `UPDATE employee
       SET emp_aadhar = $1, emp_pan = $2
       WHERE emp_id = $3`,
      [aadharEncrypted, panEncrypted, emp.emp_id]
    );

    console.log(
      `${emp.emp_id}: updated ${result.rowCount} row(s).`
    );
  }

  console.log("Done. You can now restart the backend and check the Employee list.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error fixing test employee encryption:", err);
  process.exit(1);
});