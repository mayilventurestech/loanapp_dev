const express = require("express");
const pool = require("../db");
const { encryptValue, decryptValue, hashValue } = require("../crypto-helper");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cust_pk, cust_id, cust__fname, cust_lname, cust_email, cust_phone,
              cust_country, cust_addressline1, cust_addressline2, cust_city,
              cust_state, cust_pinzip, cust_createddt, cust_insertedby_empid
       FROM customer
       ORDER BY cust_pk DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get customers error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/", async (req, res) => {
  const {
    cust_fname,
    cust_lname,
    cust_email,
    cust_phone,
    cust_aadhar,
    cust_pan,
    cust_country,
    cust_addressline1,
    cust_addressline2,
    cust_city,
    cust_state,
    cust_pinzip,
    cust_insertedby_empid,
  } = req.body;

  if (!cust_fname || !cust_lname || !cust_email || !cust_phone || !cust_aadhar || !cust_pan || !cust_addressline1) {
    return res.status(400).json({
      success: false,
      message: "cust_fname, cust_lname, cust_email, cust_phone, cust_aadhar, cust_pan, and cust_addressline1 are required.",
    });
  }

  try {
    const aadharEncrypted = encryptValue(cust_aadhar).toString("base64");
    const panEncrypted = encryptValue(cust_pan).toString("base64");
    const aadharHash = hashValue(cust_aadhar);
    const panHash = hashValue(cust_pan);

    const result = await pool.query(
      `INSERT INTO customer (
        cust__fname, cust_lname, cust_email, cust_phone,
        cust_aadhar, cust_pan, cust_aadhar_hash, cust_pan_hash,
        cust_country, cust_addressline1, cust_addressline2,
        cust_city, cust_state, cust_pinzip, cust_insertedby_empid
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING cust_pk, cust_id, cust__fname, cust_lname, cust_email, cust_phone,
                cust_country, cust_addressline1, cust_addressline2, cust_city,
                cust_state, cust_pinzip, cust_createddt, cust_insertedby_empid`,
      [
        cust_fname,
        cust_lname,
        cust_email,
        cust_phone,
        aadharEncrypted,
        panEncrypted,
        aadharHash,
        panHash,
        cust_country || "India",
        cust_addressline1,
        cust_addressline2,
        cust_city,
        cust_state,
        cust_pinzip,
        cust_insertedby_empid,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create customer error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;