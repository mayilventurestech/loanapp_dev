const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET status history, optionally filtered by loan_id
// e.g. /api/loan-status-history?loan_id=2
router.get("/", async (req, res) => {
  const { loan_id } = req.query;

  try {
    let result;
    if (loan_id) {
      result = await pool.query(
        `SELECT status_pk, loan_id, loan_status, status_dt, updated_by_empid, remarks
         FROM loan_status_history
         WHERE loan_id = $1
         ORDER BY status_dt DESC`,
        [loan_id]
      );
    } else {
      result = await pool.query(
        `SELECT status_pk, loan_id, loan_status, status_dt, updated_by_empid, remarks
         FROM loan_status_history
         ORDER BY status_dt DESC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get loan status history error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new status entry
router.post("/", async (req, res) => {
  const { loan_id, loan_status, updated_by_empid, remarks } = req.body;

  if (!loan_id || !loan_status) {
    return res.status(400).json({
      success: false,
      message: "loan_id and loan_status are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO loan_status_history (loan_id, loan_status, updated_by_empid, remarks)
       VALUES ($1, $2, $3, $4)
       RETURNING status_pk, loan_id, loan_status, status_dt, updated_by_empid, remarks`,
      [loan_id, loan_status, updated_by_empid, remarks]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create loan status entry error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;