const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET logs, optionally filtered by user_id
// e.g. /api/app-logs?user_id=mayilventurestech@gmail.com
router.get("/", async (req, res) => {
  const { user_id } = req.query;

  try {
    let result;
    if (user_id) {
      result = await pool.query(
        `SELECT log_pk, user_type, user_id, action_type, module_name, record_id,
                description, login_dt, logout_dt, ip_address, activity_dt
         FROM app_logs
         WHERE user_id = $1
         ORDER BY activity_dt DESC`,
        [user_id]
      );
    } else {
      result = await pool.query(
        `SELECT log_pk, user_type, user_id, action_type, module_name, record_id,
                description, login_dt, logout_dt, ip_address, activity_dt
         FROM app_logs
         ORDER BY activity_dt DESC
         LIMIT 200`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get app logs error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;