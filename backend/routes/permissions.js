const express = require("express");
const pool = require("../db");

const router = express.Router();

// ----------------------------------------------------------------
// Only a Super Admin may view or change the permissions grid.
// req.user is set by the verifyToken middleware (already applied in
// server.js before this router runs) - it's the decoded JWT payload
// from login-v2.js: { email, employee_id, role_pk, role }.
// ----------------------------------------------------------------
async function requireSuperAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.role_pk) {
      return res.status(403).json({
        success: false,
        message: "Not authorized.",
      });
    }

    const result = await pool.query(
      `SELECT role_code FROM roles WHERE role_pk = $1`,
      [req.user.role_pk]
    );

    if (result.rows.length === 0 || result.rows[0].role_code !== "SUPER_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only a Super Admin can view or change page permissions.",
      });
    }

    next();
  } catch (err) {
    console.error("Permission check error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
}

// GET the full grid in one shot: every role, every feature, and every
// existing role+feature permission row. The frontend settings screen
// builds its table from these three lists (a role with no row yet for
// a given feature just means everything is false for that combo).
router.get("/grid", requireSuperAdmin, async (req, res) => {
  try {
    const roles = await pool.query(
      `SELECT role_pk, role_code, role_name FROM roles ORDER BY role_pk`
    );
    const features = await pool.query(
      `SELECT feature_pk, feature_code, feature_name FROM features ORDER BY feature_pk`
    );
    const perms = await pool.query(
      `SELECT permission_pk, role_pk, feature_pk, can_view, can_edit, can_delete
       FROM role_permissions`
    );

    res.json({
      success: true,
      roles: roles.rows,
      features: features.rows,
      permissions: perms.rows,
    });
  } catch (err) {
    console.error("Get permissions grid error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PUT: set the view/edit/delete checkboxes for ONE role+feature cell.
// If that role+feature combination has no row yet, this creates it;
// if it already exists, this updates it. So the frontend can call this
// every time a checkbox is toggled, without worrying which case it is.
router.put("/", requireSuperAdmin, async (req, res) => {
  const { role_pk, feature_pk, can_view, can_edit, can_delete } = req.body;

  if (!role_pk || !feature_pk) {
    return res.status(400).json({
      success: false,
      message: "role_pk and feature_pk are required.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO role_permissions (role_pk, feature_pk, can_view, can_edit, can_delete)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (role_pk, feature_pk)
       DO UPDATE SET can_view = $3, can_edit = $4, can_delete = $5
       RETURNING permission_pk, role_pk, feature_pk, can_view, can_edit, can_delete`,
      [
        role_pk,
        feature_pk,
        can_view === true,
        can_edit === true,
        can_delete === true,
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Update permission error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;