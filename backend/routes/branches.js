const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET all branches
// Joins to the employee table 4 times (once per head role) so the
// frontend gets the actual employee's name to display, not just the
// raw emp_id. The raw emp_id is still included too (e.g. branch_head),
// which is what a dropdown needs pre-selected when editing a branch.
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.branch_pk, b.branch_code, b.branch_status, b.branch_Type, b.branch_name,
              b.branch_addressline1, b.branch_addressline2, b.branch_city, b.branch_state,
              b.branch_pincode, b.branch_email, b.branch_phone, b.branch_createdby, b.branch_createddt,
              b.branch_head, bh.emp_fname AS branch_head_fname, bh.emp_lname AS branch_head_lname,
              b.primary_head, ph.emp_fname AS primary_head_fname, ph.emp_lname AS primary_head_lname,
              b.secondary_head, sh.emp_fname AS secondary_head_fname, sh.emp_lname AS secondary_head_lname,
              b.operations_head, oh.emp_fname AS operations_head_fname, oh.emp_lname AS operations_head_lname
       FROM branch b
       LEFT JOIN employee bh ON b.branch_head = bh.emp_id
       LEFT JOIN employee ph ON b.primary_head = ph.emp_id
       LEFT JOIN employee sh ON b.secondary_head = sh.emp_id
       LEFT JOIN employee oh ON b.operations_head = oh.emp_id
       ORDER BY b.branch_pk DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get branches error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new branch
router.post("/", async (req, res) => {
  const {
    branch_code,
    branch_status,
    branch_Type,
    branch_name,
    branch_addressline1,
    branch_addressline2,
    branch_city,
    branch_state,
    branch_pincode,
    branch_email,
    branch_phone,
    branch_createdby,
    branch_head,
    primary_head,
    secondary_head,
    operations_head,
  } = req.body;

  if (!branch_code || !branch_name) {
    return res.status(400).json({
      success: false,
      message: "branch_code and branch_name are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO branch (
        branch_code, branch_status, branch_Type, branch_name,
        branch_addressline1, branch_addressline2, branch_city, branch_state,
        branch_pincode, branch_email, branch_phone, branch_createdby,
        branch_head, primary_head, secondary_head, operations_head
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING branch_pk, branch_code, branch_status, branch_Type, branch_name,
                branch_addressline1, branch_addressline2, branch_city, branch_state,
                branch_pincode, branch_email, branch_phone, branch_createdby, branch_createddt,
                branch_head, primary_head, secondary_head, operations_head`,
      [
        branch_code,
        branch_status !== undefined ? branch_status : true,
        branch_Type !== undefined ? branch_Type : false,
        branch_name,
        branch_addressline1,
        branch_addressline2,
        branch_city,
        branch_state,
        branch_pincode,
        branch_email,
        branch_phone,
        branch_createdby,
        branch_head || null,
        primary_head || null,
        secondary_head || null,
        operations_head || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create branch error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;