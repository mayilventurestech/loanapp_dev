const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET all branches
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT branch_pk, branch_code, branch_status, branch_Type, branch_name,
              branch_addressline1, branch_addressline2, branch_city, branch_state,
              branch_pincode, branch_email, branch_phone, branch_createdby, branch_createddt
       FROM branch
       ORDER BY branch_pk DESC`
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
        branch_pincode, branch_email, branch_phone, branch_createdby
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING branch_pk, branch_code, branch_status, branch_Type, branch_name,
                branch_addressline1, branch_addressline2, branch_city, branch_state,
                branch_pincode, branch_email, branch_phone, branch_createdby, branch_createddt`,
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
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create branch error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;