const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET penalty records, optionally filtered by loan_id
// e.g. /api/loan-penalty?loan_id=2
router.get("/", async (req, res) => {
  const { loan_id } = req.query;

  try {
    let result;
    if (loan_id) {
      result = await pool.query(
        `SELECT penalty_pk, loan_id, schedule_pk, penalty_amount, penalty_reason, penalty_dt
         FROM loan_penalty
         WHERE loan_id = $1
         ORDER BY penalty_dt DESC`,
        [loan_id]
      );
    } else {
      result = await pool.query(
        `SELECT penalty_pk, loan_id, schedule_pk, penalty_amount, penalty_reason, penalty_dt
         FROM loan_penalty
         ORDER BY penalty_dt DESC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get loan penalty error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new penalty record
router.post("/", async (req, res) => {
  const { loan_id, schedule_pk, penalty_amount, penalty_reason, penalty_dt } = req.body;

  if (!loan_id || !penalty_amount || !penalty_reason) {
    return res.status(400).json({
      success: false,
      message: "loan_id, penalty_amount, and penalty_reason are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO loan_penalty (loan_id, schedule_pk, penalty_amount, penalty_reason, penalty_dt)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING penalty_pk, loan_id, schedule_pk, penalty_amount, penalty_reason, penalty_dt`,
      [loan_id, schedule_pk, penalty_amount, penalty_reason, penalty_dt || new Date()]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create loan penalty error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;