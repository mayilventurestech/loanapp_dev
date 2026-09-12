const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET documents, optionally filtered by cust_pk
// e.g. /api/customer-documents?cust_pk=4
router.get("/", async (req, res) => {
  const { cust_pk } = req.query;

  try {
    let result;
    if (cust_pk) {
      result = await pool.query(
        `SELECT document_pk, cust_pk, document_type, document_file_path, is_verified, uploaded_dt
         FROM customer_documents
         WHERE cust_pk = $1
         ORDER BY uploaded_dt DESC`,
        [cust_pk]
      );
    } else {
      result = await pool.query(
        `SELECT document_pk, cust_pk, document_type, document_file_path, is_verified, uploaded_dt
         FROM customer_documents
         ORDER BY uploaded_dt DESC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get customer documents error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST a new document record
router.post("/", async (req, res) => {
  const { cust_pk, document_type, document_file_path, is_verified } = req.body;

  if (!cust_pk || !document_type || !document_file_path) {
    return res.status(400).json({
      success: false,
      message: "cust_pk, document_type, and document_file_path are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customer_documents (cust_pk, document_type, document_file_path, is_verified)
       VALUES ($1, $2, $3, $4)
       RETURNING document_pk, cust_pk, document_type, document_file_path, is_verified, uploaded_dt`,
      [cust_pk, document_type, document_file_path, is_verified || false]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create customer document error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;