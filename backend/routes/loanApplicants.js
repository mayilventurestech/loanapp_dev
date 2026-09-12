const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET all loan applicants, optionally filtered by loan_id
// e.g. /api/loan-applicants?loan_id=1
router.get("/", async (req, res) => {
  const { loan_id } = req.query;

  try {
    let result;
    if (loan_id) {
      result = await pool.query(
        "SELECT loan_id, customerid, applicant_role FROM loan_applicants WHERE loan_id = $1",
        [loan_id]
      );
    } else {
      result = await pool.query(
        "SELECT loan_id, customerid, applicant_role FROM loan_applicants ORDER BY loan_id DESC"
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get loan applicants error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new applicant link (loan_id + customerid + role)
router.post("/", async (req, res) => {
  const { loan_id, customerid, applicant_role } = req.body;

  if (!loan_id || !customerid || !applicant_role) {
    return res.status(400).json({
      success: false,
      message: "loan_id, customerid, and applicant_role are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO loan_applicants (loan_id, customerid, applicant_role)
       VALUES ($1, $2, $3)
       RETURNING loan_id, customerid, applicant_role`,
      [loan_id, customerid, applicant_role]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create loan applicant error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;