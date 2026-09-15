const express = require("express");
const pool = require("../db");
const { encryptValue, decryptValue, hashValue } = require("../crypto-helper");

const router = express.Router();

// Same dual-fallback decrypt as customers.js - handles bytea columns
// correctly, whether a row's Aadhaar/PAN was saved as raw binary (the
// correct way, used everywhere below) or as a base64 text string.
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

// GET /api/leads - list all leads
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lead_pk, lead_id, lead_fname, lead_lname, lead_email, lead_phone,
              lead_aadhar, lead_pan,
              lead_country, lead_addressline1, lead_addressline2, lead_city,
              lead_state, lead_pinzip,
              lead_status, lead_source, lead_createdby, lead_createddt,
              lead_interested_loan_type, lead_interested_amount, lead_followup_date
       FROM leads
       ORDER BY lead_pk DESC`
    );

    const rows = result.rows.map((row) => ({
      ...row,
      lead_aadhar: safeDecrypt(row.lead_aadhar),
      lead_pan: safeDecrypt(row.lead_pan),
    }));

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Get leads error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/leads - add a new lead
// Aadhaar/PAN are OPTIONAL here (unlike Customer) - a lead is just an
// enquiry, full KYC usually isn't collected until they're converted.
router.post("/", async (req, res) => {
  const {
    lead_fname,
    lead_lname,
    lead_email,
    lead_phone,
    lead_aadhar,
    lead_pan,
    lead_country,
    lead_addressline1,
    lead_addressline2,
    lead_city,
    lead_state,
    lead_pinzip,
    lead_source,
    lead_createdby,
    lead_interested_loan_type,
    lead_interested_amount,
    lead_followup_date,
  } = req.body;

  if (!lead_fname || !lead_lname || !lead_phone) {
    return res.status(400).json({
      success: false,
      message: "lead_fname, lead_lname, and lead_phone are required.",
    });
  }

  try {
    const aadharEncrypted = lead_aadhar ? encryptValue(lead_aadhar) : null;
    const panEncrypted = lead_pan ? encryptValue(lead_pan) : null;
    const aadharHash = lead_aadhar ? hashValue(lead_aadhar) : null;
    const panHash = lead_pan ? hashValue(lead_pan) : null;

    const result = await pool.query(
      `INSERT INTO leads (
        lead_fname, lead_lname, lead_email, lead_phone,
        lead_aadhar, lead_pan, lead_aadhar_hash, lead_pan_hash,
        lead_country, lead_addressline1, lead_addressline2,
        lead_city, lead_state, lead_pinzip,
        lead_status, lead_source, lead_createdby,
        lead_interested_loan_type, lead_interested_amount, lead_followup_date
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        'Initiate', $15, COALESCE($16, 'EMP003'),
        $17, $18, $19
      )
      RETURNING lead_pk, lead_id, lead_fname, lead_lname, lead_email, lead_phone,
                lead_status, lead_source, lead_createdby, lead_createddt,
                lead_interested_loan_type, lead_interested_amount, lead_followup_date`,
      [
        lead_fname,
        lead_lname,
        lead_email || null,
        lead_phone,
        aadharEncrypted,
        panEncrypted,
        aadharHash,
        panHash,
        lead_country || "India",
        lead_addressline1 || null,
        lead_addressline2 || null,
        lead_city || null,
        lead_state || null,
        lead_pinzip || null,
        lead_source || null,
        lead_createdby || null, // reserved for the real logged-in employee's emp_id, once that exists
        lead_interested_loan_type || null,
        lead_interested_amount || null,
        lead_followup_date || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create lead error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PATCH /api/leads/:leadId/status - update just the status
// (e.g. moving a lead from "Initiate" to "Processing" as it's worked on)
router.patch("/:leadId/status", async (req, res) => {
  const { leadId } = req.params;
  const { lead_status } = req.body;

  if (!["Initiate", "Processing", "Convert"].includes(lead_status)) {
    return res.status(400).json({
      success: false,
      message: "lead_status must be Initiate, Processing, or Convert.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE leads SET lead_status = $1 WHERE lead_pk = $2
       RETURNING lead_pk, lead_id, lead_status`,
      [lead_status, leadId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Update lead status error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/leads/:leadId/convert
//
// THE connection point between Lead ID and Customer ID. Creates the
// customer record using the SAME ID the lead already has (no new ID
// generated), and marks the lead's status as "Convert". Both happen in
// one transaction - either both succeed, or neither does.
router.post("/:leadId/convert", async (req, res) => {
  const { leadId } = req.params; // this is lead_pk

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

    // Look up this lead's existing ID - this is what the new customer
    // record will use too, per the one-shared-ID design.
    const leadLookup = await client.query(
      `SELECT lead_id FROM leads WHERE lead_pk = $1`,
      [leadId]
    );
    if (leadLookup.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Lead not found." });
    }
    const existingLeadId = leadLookup.rows[0].lead_id;

    const aadharEncrypted = encryptValue(cust_aadhar);
    const panEncrypted = encryptValue(cust_pan);
    const aadharHash = hashValue(cust_aadhar);
    const panHash = hashValue(cust_pan);

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
        existingLeadId,
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

    await client.query(
      `UPDATE leads SET lead_status = 'Convert' WHERE lead_pk = $1`,
      [leadId]
    );

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
      console.error("Could not auto-create login for converted lead:", loginErr);
    }

    await client.query("COMMIT");
    res.status(201).json({ success: true, data: custResult.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Convert lead to customer error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  } finally {
    client.release();
  }
});

module.exports = router;