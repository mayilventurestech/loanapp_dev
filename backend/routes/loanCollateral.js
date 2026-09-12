const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET collateral records, optionally filtered by loan_id
// e.g. /api/loan-collateral?loan_id=2
router.get("/", async (req, res) => {
  const { loan_id } = req.query;

  try {
    let result;
    if (loan_id) {
      result = await pool.query(
        `SELECT collateral_pk, loan_id, collateral_type, collateral_value,
                collateral_description, document_reference
         FROM loan_collateral
         WHERE loan_id = $1`,
        [loan_id]
      );
    } else {
      result = await pool.query(
        `SELECT collateral_pk, loan_id, collateral_type, collateral_value,
                collateral_description, document_reference
         FROM loan_collateral
         ORDER BY collateral_pk DESC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get loan collateral error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new collateral record
router.post("/", async (req, res) => {
  const { loan_id, collateral_type, collateral_value, collateral_description, document_reference } = req.body;

  if (!loan_id || !collateral_type || !collateral_value) {
    return res.status(400).json({
      success: false,
      message: "loan_id, collateral_type, and collateral_value are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO loan_collateral (loan_id, collateral_type, collateral_value, collateral_description, document_reference)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING collateral_pk, loan_id, collateral_type, collateral_value, collateral_description, document_reference`,
      [loan_id, collateral_type, collateral_value, collateral_description, document_reference]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create loan collateral error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;