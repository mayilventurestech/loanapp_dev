const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET payment transactions, optionally filtered by loan_id
// e.g. /api/payment-transactions?loan_id=2
router.get("/", async (req, res) => {
  const { loan_id } = req.query;

  try {
    let result;
    if (loan_id) {
      result = await pool.query(
        `SELECT payment_pk, loan_id, payment_amount, payment_dt, payment_mode,
                payment_reference, payment_status
         FROM payment_transactions
         WHERE loan_id = $1
         ORDER BY payment_dt DESC`,
        [loan_id]
      );
    } else {
      result = await pool.query(
        `SELECT payment_pk, loan_id, payment_amount, payment_dt, payment_mode,
                payment_reference, payment_status
         FROM payment_transactions
         ORDER BY payment_dt DESC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get payment transactions error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new payment transaction
router.post("/", async (req, res) => {
  const { loan_id, payment_amount, payment_mode, payment_reference, payment_status } = req.body;

  if (!loan_id || !payment_amount || !payment_mode) {
    return res.status(400).json({
      success: false,
      message: "loan_id, payment_amount, and payment_mode are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO payment_transactions (loan_id, payment_amount, payment_mode, payment_reference, payment_status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING payment_pk, loan_id, payment_amount, payment_dt, payment_mode, payment_reference, payment_status`,
      [loan_id, payment_amount, payment_mode, payment_reference, payment_status || "Success"]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create payment transaction error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;