import jwt from "jsonwebtoken";
import { findUserById } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret";

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated." });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = findUserById(payload.id);
    if (!user) return res.status(401).json({ error: "Account no longer exists." });
    if (user.role === "student" && user.status !== "approved") {
      return res.status(403).json({ error: "Your account is not approved." });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}
