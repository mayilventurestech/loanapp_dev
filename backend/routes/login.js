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
      `SELECT employee_id, employee_fname, employee_lname, email, password_hash, role, role_pk
       FROM tbl_applogin WHERE email = $1`,
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

    // Look up this role's full permission list right now, so the
    // frontend gets everything it needs to build the menu in this same
    // response - no second API call needed.
    // NOTE: since this only runs at login, a permission change made by
    // a Super Admin won't take effect for someone already logged in
    // until their 8-hour token expires and they log in again.
    const permissionsResult = await pool.query(
      `SELECT f.feature_code, f.feature_name, rp.can_view, rp.can_edit, rp.can_delete
       FROM role_permissions rp
       JOIN features f ON rp.feature_pk = f.feature_pk
       WHERE rp.role_pk = $1`,
      [user.role_pk]
    );

    // The token now carries WHO this is (employee_id, role) - not just
    // their email. This is what finally lets every "who is logged in"
    // feature (createdby fields, permission checks, etc.) work properly
    // instead of relying on hardcoded fallbacks like EMP003.
    const token = jwt.sign(
      {
        email: user.email,
        employee_id: user.employee_id,
        role_pk: user.role_pk,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    // Record this login in app_logs - now uses the person's REAL role
    // instead of always saying "Employee" (which was wrong whenever a
    // Customer logged in).
    await pool.query(
      `INSERT INTO app_logs (user_type, user_id, action_type, module_name, description, login_dt, ip_address)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [user.role || "Employee", user.email, "LOGIN", "Login", "User logged in", req.ip]
    );

    return res.json({
      success: true,
      token,
      user: {
        employee_id: user.employee_id,
        fname: user.employee_fname,
        lname: user.employee_lname,
        email: user.email,
        role: user.role,
        role_pk: user.role_pk,
      },
      permissions: permissionsResult.rows,
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