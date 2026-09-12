const jwt = require("jsonwebtoken");

// This function checks: did the request include a valid login token?
// If yes, it lets the request continue. If no, it blocks it immediately.
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "No token provided. Please log in.",
    });
  }

  const token = authHeader.split(" ")[1]; // "Bearer <token>" -> just the token part

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach the logged-in user's info to this request
    next(); // token valid, continue to the actual route
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token. Please log in again.",
    });
  }
}

module.exports = verifyToken;