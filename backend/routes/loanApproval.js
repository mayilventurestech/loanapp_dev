const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET approval records, optionally filtered by loan_id
// e.g. /api/loan-approval?loan_id=2
router.get("/", async (req, res) => {
  const { loan_id } = req.query;

  try {
    let result;
    if (loan_id) {
      result = await pool.query(
        `SELECT approval_pk, loan_id, approver_empid, approval_level,
                approval_decision, decision_dt, remarks
         FROM loan_approval
         WHERE loan_id = $1
         ORDER BY decision_dt DESC`,
        [loan_id]
      );
    } else {
      result = await pool.query(
        `SELECT approval_pk, loan_id, approver_empid, approval_level,
                approval_decision, decision_dt, remarks
         FROM loan_approval
         ORDER BY decision_dt DESC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get loan approval error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new approval decision
router.post("/", async (req, res) => {
  const { loan_id, approver_empid, approval_level, approval_decision, remarks } = req.body;

  if (!loan_id || !approver_empid || !approval_decision) {
    return res.status(400).json({
      success: false,
      message: "loan_id, approver_empid, and approval_decision are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO loan_approval (loan_id, approver_empid, approval_level, approval_decision, remarks)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING approval_pk, loan_id, approver_empid, approval_level, approval_decision, decision_dt, remarks`,
      [loan_id, approver_empid, approval_level, approval_decision, remarks]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create loan approval error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;