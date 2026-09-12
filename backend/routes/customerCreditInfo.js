const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET credit info, optionally filtered by cust_pk
// e.g. /api/customer-credit-info?cust_pk=4
router.get("/", async (req, res) => {
  const { cust_pk } = req.query;

  try {
    let result;
    if (cust_pk) {
      result = await pool.query(
        `SELECT credit_pk, cust_pk, cibil_score, risk_category, checked_dt
         FROM customer_credit_info
         WHERE cust_pk = $1
         ORDER BY checked_dt DESC`,
        [cust_pk]
      );
    } else {
      result = await pool.query(
        `SELECT credit_pk, cust_pk, cibil_score, risk_category, checked_dt
         FROM customer_credit_info
         ORDER BY checked_dt DESC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get customer credit info error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new credit info record
router.post("/", async (req, res) => {
  const { cust_pk, cibil_score, risk_category, checked_dt } = req.body;

  if (!cust_pk || !cibil_score) {
    return res.status(400).json({
      success: false,
      message: "cust_pk and cibil_score are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customer_credit_info (cust_pk, cibil_score, risk_category, checked_dt)
       VALUES ($1, $2, $3, $4)
       RETURNING credit_pk, cust_pk, cibil_score, risk_category, checked_dt`,
      [cust_pk, cibil_score, risk_category, checked_dt || new Date()]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create customer credit info error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;