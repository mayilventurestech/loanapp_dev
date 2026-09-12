const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT loan_id, loan_type_id, loan_amount, loan_interest, loan_tenure,
              loan_tenureunit, loan_frequency, loan_disbursementdt,
              loan_installmentstartdt, loan_enddt, loan_totalinstallments,
              loan_subsidizedamount, loan_custirr, loan_busirr,
              loan_totalinterest, loan_agreementvalue, loan_createddt,
              loan_insertedby_empid
       FROM loan_info
       ORDER BY loan_id DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get loans error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/", async (req, res) => {
  const {
    loan_type_id,
    loan_amount,
    loan_interest,
    loan_tenure,
    loan_tenureunit,
    loan_frequency,
    loan_disbursementdt,
    loan_installmentstartdt,
    loan_enddt,
    loan_totalinstallments,
    loan_subsidizedamount,
    loan_custirr,
    loan_busirr,
    loan_totalinterest,
    loan_agreementvalue,
    loan_insertedby_empid,
  } = req.body;

  if (
    !loan_type_id || !loan_amount || !loan_interest || !loan_tenure ||
    !loan_tenureunit || !loan_frequency || !loan_disbursementdt ||
    !loan_installmentstartdt || !loan_enddt || !loan_totalinstallments ||
    !loan_custirr || !loan_busirr || !loan_totalinterest ||
    !loan_agreementvalue || !loan_insertedby_empid
  ) {
    return res.status(400).json({
      success: false,
      message: "Missing required loan fields. Check loan_type_id, amounts, dates, rates, and loan_insertedby_empid.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO loan_info (
        loan_type_id, loan_amount, loan_interest, loan_tenure,
        loan_tenureunit, loan_frequency, loan_disbursementdt,
        loan_installmentstartdt, loan_enddt, loan_totalinstallments,
        loan_subsidizedamount, loan_custirr, loan_busirr,
        loan_totalinterest, loan_agreementvalue, loan_insertedby_empid
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING loan_id, loan_type_id, loan_amount, loan_interest, loan_tenure,
                loan_tenureunit, loan_frequency, loan_disbursementdt,
                loan_installmentstartdt, loan_enddt, loan_totalinstallments,
                loan_subsidizedamount, loan_custirr, loan_busirr,
                loan_totalinterest, loan_agreementvalue, loan_createddt,
                loan_insertedby_empid`,
      [
        loan_type_id,
        loan_amount,
        loan_interest,
        loan_tenure,
        loan_tenureunit,
        loan_frequency,
        loan_disbursementdt,
        loan_installmentstartdt,
        loan_enddt,
        loan_totalinstallments,
        loan_subsidizedamount || 0.0,
        loan_custirr,
        loan_busirr,
        loan_totalinterest,
        loan_agreementvalue,
        loan_insertedby_empid,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create loan error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;