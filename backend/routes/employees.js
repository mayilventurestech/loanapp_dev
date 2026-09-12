const express = require("express");
const pool = require("../db");
const { encryptValue, decryptValue } = require("../crypto-helper");

const router = express.Router();

// Safely turns a stored (base64) Aadhar/PAN value back into plain text.
// Returns null if there's nothing stored, or if it can't be decrypted
// (this protects against old/test rows that were never properly encrypted).
function safeDecrypt(base64Value) {
  if (!base64Value) return null;
  try {
    const buffer = Buffer.from(base64Value, "base64");
    return decryptValue(buffer);
  } catch (err) {
    return null;
  }
}

// GET all employees, optionally filtered by designation level
// e.g. /api/employees?level=L6
router.get("/", async (req, res) => {
  const { level } = req.query;

  try {
    let result;
    if (level) {
      result = await pool.query(
        `SELECT e.emp_id, e.emp_fname, e.emp_lname, e.emp_email, e.emp_phone,
                e.emp_branch_code, e.emp_city, e.emp_state, e.emp_joindt,
                e.emp_status, e.emp_reporting_manager_id, e.emp_createdby, e.emp_createddt,
                e.emp_aadhar, e.emp_pan,
                d.designation_code, d.designation_name, d.designation_level
         FROM employee e
         JOIN emp_designation d ON e.emp_designation_code = d.designation_code
         WHERE d.designation_code = $1
         ORDER BY e.emp_id`,
        [level]
      );
    } else {
      result = await pool.query(
        `SELECT e.emp_id, e.emp_fname, e.emp_lname, e.emp_email, e.emp_phone,
                e.emp_branch_code, e.emp_city, e.emp_state, e.emp_joindt,
                e.emp_status, e.emp_reporting_manager_id, e.emp_createdby, e.emp_createddt,
                e.emp_aadhar, e.emp_pan,
                d.designation_code, d.designation_name, d.designation_level
         FROM employee e
         JOIN emp_designation d ON e.emp_designation_code = d.designation_code
         ORDER BY e.emp_id`
      );
    }

    // Decrypt Aadhar/PAN for each employee before sending it to the frontend
    const rows = result.rows.map((row) => ({
      ...row,
      emp_aadhar: safeDecrypt(row.emp_aadhar),
      emp_pan: safeDecrypt(row.emp_pan),
    }));

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Get employees error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new employee (unchanged from before)
router.post("/", async (req, res) => {
  const {
    emp_id,
    emp_fname,
    emp_lname,
    emp_email,
    emp_phone,
    emp_branch_code,
    emp_addressline1,
    emp_city,
    emp_state,
    emp_pinzip,
    emp_aadhar,
    emp_pan,
    emp_joindt,
    emp_status,
    emp_designation_code,
    emp_reporting_manager_id,
    emp_createdby,
  } = req.body;

  if (!emp_id || !emp_fname || !emp_lname || !emp_email) {
    return res.status(400).json({
      success: false,
      message: "emp_id, emp_fname, emp_lname, and emp_email are required.",
    });
  }

  try {
    const aadharEncrypted = emp_aadhar ? encryptValue(emp_aadhar).toString("base64") : null;
    const panEncrypted = emp_pan ? encryptValue(emp_pan).toString("base64") : null;

    const result = await pool.query(
      `INSERT INTO employee (
        emp_id, emp_fname, emp_lname, emp_email, emp_phone, emp_branch_code,
        emp_addressline1, emp_city, emp_state, emp_pinzip, emp_aadhar, emp_pan,
        emp_joindt, emp_status, emp_designation_code, emp_reporting_manager_id, emp_createdby
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING emp_pk, emp_id, emp_fname, emp_lname, emp_email, emp_phone,
                emp_branch_code, emp_city, emp_state, emp_joindt, emp_status,
                emp_designation_code, emp_reporting_manager_id, emp_createdby, emp_createddt`,
      [
        emp_id,
        emp_fname,
        emp_lname,
        emp_email,
        emp_phone,
        emp_branch_code,
        emp_addressline1,
        emp_city,
        emp_state,
        emp_pinzip,
        aadharEncrypted,
        panEncrypted,
        emp_joindt,
        emp_status !== undefined ? emp_status : true,
        emp_designation_code,
        emp_reporting_manager_id,
        emp_createdby,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create employee error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;