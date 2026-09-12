const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET repayment schedule, optionally filtered by loan_id
// e.g. /api/loan-repayment-schedule?loan_id=2
router.get("/", async (req, res) => {
  const { loan_id } = req.query;

  try {
    let result;
    if (loan_id) {
      result = await pool.query(
        `SELECT schedule_pk, loan_id, installment_number, due_dt, emi_amount,
                principal_component, interest_component, paid_amount, paid_dt, payment_status
         FROM loan_repayment_schedule
         WHERE loan_id = $1
         ORDER BY installment_number ASC`,
        [loan_id]
      );
    } else {
      result = await pool.query(
        `SELECT schedule_pk, loan_id, installment_number, due_dt, emi_amount,
                principal_component, interest_component, paid_amount, paid_dt, payment_status
         FROM loan_repayment_schedule
         ORDER BY loan_id, installment_number ASC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get repayment schedule error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new schedule entry
router.post("/", async (req, res) => {
  const {
    loan_id,
    installment_number,
    due_dt,
    emi_amount,
    principal_component,
    interest_component,
    paid_amount,
    paid_dt,
    payment_status,
  } = req.body;

  if (!loan_id || !installment_number || !due_dt || !emi_amount) {
    return res.status(400).json({
      success: false,
      message: "loan_id, installment_number, due_dt, and emi_amount are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO loan_repayment_schedule (
        loan_id, installment_number, due_dt, emi_amount,
        principal_component, interest_component, paid_amount, paid_dt, payment_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING schedule_pk, loan_id, installment_number, due_dt, emi_amount,
                principal_component, interest_component, paid_amount, paid_dt, payment_status`,
      [
        loan_id,
        installment_number,
        due_dt,
        emi_amount,
        principal_component,
        interest_component,
        paid_amount || 0,
        paid_dt,
        payment_status || "Pending",
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create repayment schedule entry error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;