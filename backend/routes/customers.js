const express = require("express");
const pool = require("../db");
const { encryptValue, decryptValue, hashValue } = require("../crypto-helper");

const router = express.Router();

// Safely turns a stored Aadhar/PAN value back into plain text.
// cust_aadhar/cust_pan are real "bytea" (binary) columns, so pg normally
// hands them back as a Node Buffer already - that's the CORRECT, current
// way values are saved (see the POST route below).
//
// Some OLDER rows, however, were saved by first converting the encrypted
// value to a base64 TEXT string and writing that string into the bytea
// column - meaning what comes back for those rows is really the raw
// ASCII bytes of a base64 string, not the ciphertext itself yet. This
// function tries the correct (new) way first, and only falls back to the
// old (base64-text) way if that fails - so both old and new rows keep
// working without needing to know in advance which way a given row was
// saved.
function safeDecrypt(value) {
  if (!value) return null;

  const rawBuffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "base64");

  try {
    return decryptValue(rawBuffer);
  } catch (err1) {
    try {
      const reDecoded = Buffer.from(rawBuffer.toString("utf8"), "base64");
      return decryptValue(reDecoded);
    } catch (err2) {
      return null;
    }
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

// POST /api/customers - "Add Customer" (direct, no prior Lead)
//
// Per the one-shared-ID design: customer.cust_id is NEVER auto-generated
// by the customer table anymore (that trigger was removed). So a direct
// Add Customer now quietly creates a Lead first (status set straight to
// "Convert", source "Direct") purely to mint the ID, then creates the
// customer using that same ID. The employee using the form sees no
// difference at all - they just click Register Customer like always.
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Encrypt once, reuse for both the lead row and the customer row.
    // Passed as raw Buffers (NOT base64 text) since these are real
    // bytea columns - this is the correct way going forward.
    const aadharEncrypted = encryptValue(cust_aadhar);
    const panEncrypted = encryptValue(cust_pan);
    const aadharHash = hashValue(cust_aadhar);
    const panHash = hashValue(cust_pan);

    // Step 1: silently create a Lead, status already "Convert", just to
    // mint the shared ID. lead_createdby falls back to EMP003 for now,
    // same reason as cust_insertedby_empid below - no real "who's logged
    // in" tracking yet.
    const leadResult = await client.query(
      `INSERT INTO leads (
        lead_fname, lead_lname, lead_email, lead_phone,
        lead_aadhar, lead_pan, lead_aadhar_hash, lead_pan_hash,
        lead_country, lead_addressline1, lead_addressline2,
        lead_city, lead_state, lead_pinzip,
        lead_status, lead_source, lead_createdby
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Convert','Direct',
        COALESCE($15, 'EMP003')
      )
      RETURNING lead_id`,
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
        null, // reserved for the real logged-in employee's text emp_id, once that exists
      ]
    );
    const newCustId = leadResult.rows[0].lead_id;

    // Step 2: create the customer record using that same ID
    const custResult = await client.query(
      `INSERT INTO customer (
        cust_id, cust__fname, cust_lname, cust_email, cust_phone,
        cust_aadhar, cust_pan, cust_aadhar_hash, cust_pan_hash,
        cust_country, cust_addressline1, cust_addressline2,
        cust_city, cust_state, cust_pinzip, cust_insertedby_empid
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        COALESCE($16, (SELECT emp_pk FROM employee WHERE emp_id = 'EMP003'))
      )
      RETURNING cust_pk, cust_id, cust__fname, cust_lname, cust_email, cust_phone,
                cust_country, cust_addressline1, cust_addressline2, cust_city,
                cust_state, cust_pinzip, cust_createddt, cust_insertedby_empid`,
      [
        newCustId,
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

    // Same as before: give this new customer a login too. Own try/catch
    // so a login hiccup never undoes the lead+customer already saved.
    try {
      const DEFAULT_PASSWORD_HASH =
        "e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7"; // Admin@123
      await client.query(
        `INSERT INTO tbl_applogin (employee_fname, employee_lname, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [cust_fname, cust_lname, cust_email, DEFAULT_PASSWORD_HASH, "Customer"]
      );
    } catch (loginErr) {
      console.error("Could not auto-create login for new customer:", loginErr);
    }

    await client.query("COMMIT");
    res.status(201).json({ success: true, data: custResult.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create customer error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  } finally {
    client.release();
  }
});

module.exports = router;