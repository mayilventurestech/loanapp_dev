const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
    });
  }

  try {
    const result = await pool.query(
      "SELECT email, password_hash FROM tbl_applogin WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = result.rows[0];
    const submittedHash = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");
    const passwordMatches = submittedHash === user.password_hash;

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = jwt.sign(
      { email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    // Record this login in app_logs
    await pool.query(
      `INSERT INTO app_logs (user_type, user_id, action_type, module_name, description, login_dt, ip_address)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      ["Employee", user.email, "LOGIN", "Login", "User logged in", req.ip]
    );

    return res.json({
      success: true,
      token,
      user: { email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during login.",
    });
  }
});

module.exports = router;