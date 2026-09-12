const pool = require("./db");

function watchActivity(req, res, next) {
  res.on("finish", async () => {
    try {
      if (!req.user) return;

      const methodToAction = {
        GET: "RETRIEVE",
        POST: "CREATE",
        PUT: "UPDATE",
        PATCH: "UPDATE",
        DELETE: "DELETE",
      };
      const actionType = methodToAction[req.method] || "OPEN";

      const pathParts = req.originalUrl.split("/").filter(Boolean);
      const moduleName = pathParts[1] || "unknown";
      const recordId = pathParts[2] ? pathParts[2].split("?")[0] : null;

      await pool.query(
        `INSERT INTO app_logs (user_type, user_id, action_type, module_name, record_id, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ["Employee", req.user.email, actionType, moduleName, recordId, req.ip]
      );
    } catch (err) {
      console.error("Activity logging error:", err);
    }
  });
  next();
}

module.exports = watchActivity;