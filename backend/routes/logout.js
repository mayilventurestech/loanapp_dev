const express = require("express");
const pool = require("../db");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO app_logs (user_type, user_id, action_type, module_name, description, logout_dt, ip_address)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      ["Employee", req.user.email, "LOGOUT", "Login", "User logged out", req.ip]
    );
    res.json({ success: true, message: "Logged out successfully." });
  } catch (err) {
    console.error("Logout logging error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;