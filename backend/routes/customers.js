const express = require("express");
const pool = require("../db");
const { encryptValue, decryptValue, hashValue } = require("../crypto-helper");

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

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cust_pk, cust_id, cust__fname, cust_lname, cust_email, cust_phone,
              cust_country, cust_addressline1, cust_addressline2, cust_city,
              cust_state, cust_pinzip, cust_createddt, cust_insertedby_empid,
              cust_aadhar, cust_pan
       FROM customer
       ORDER BY cust_pk DESC`
    );

    // Decrypt Aadhar/PAN for each customer before sending it to the frontend
    const rows = result.rows.map((row) => ({
      ...row,
      cust_aadhar: safeDecrypt(row.cust_aadhar),
      cust_pan: safeDecrypt(row.cust_pan),
    }));

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Get customers error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/", async (req, res) => {
  const {
    cust_fname,
    cust_lname,
    cust_email,
    cust_phone,
    cust_aadhar,
    cust_pan,
    cust_country,
    cust_addressline1,
    cust_addressline2,
    cust_city,
    cust_state,
    cust_pinzip,
    cust_insertedby_empid,
  } = req.body;

  if (!cust_fname || !cust_lname || !cust_email || !cust_phone || !cust_aadhar || !cust_pan || !cust_addressline1) {
    return res.status(400).json({
      success: false,
      message: "cust_fname, cust_lname, cust_email, cust_phone, cust_aadhar, cust_pan, and cust_addressline1 are required.",
    });
  }

  try {
    const aadharEncrypted = encryptValue(cust_aadhar).toString("base64");
    const panEncrypted = encryptValue(cust_pan).toString("base64");
    const aadharHash = hashValue(cust_aadhar);
    const panHash = hashValue(cust_pan);

    // cust_insertedby_empid is required by the database (NOT NULL) but the
    // frontend doesn't currently send it (there's no "which employee is
    // logged in" tracking yet). Rather than fail every customer save, fall
    // back to Kamala's employee record (EMP024) when nothing was sent, so
    // this doesn't block saving while that bigger feature gets built later.
    const result = await pool.query(
      `INSERT INTO customer (
        cust__fname, cust_lname, cust_email, cust_phone,
        cust_aadhar, cust_pan, cust_aadhar_hash, cust_pan_hash,
        cust_country, cust_addressline1, cust_addressline2,
        cust_city, cust_state, cust_pinzip, cust_insertedby_empid
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        COALESCE($15, (SELECT emp_pk FROM employee WHERE emp_id = 'EMP024'))
      )
      RETURNING cust_pk, cust_id, cust__fname, cust_lname, cust_email, cust_phone,
                cust_country, cust_addressline1, cust_addressline2, cust_city,
                cust_state, cust_pinzip, cust_createddt, cust_insertedby_empid`,
      [
        cust_fname,
        cust_lname,
        cust_email,
        cust_phone,
        aadharEncrypted,
        panEncrypted,
        aadharHash,
        panHash,
        cust_country || "India",
        cust_addressline1,
        cust_addressline2,
        cust_city,
        cust_state,
        cust_pinzip,
        cust_insertedby_empid || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create customer error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;