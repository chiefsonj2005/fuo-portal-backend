import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import os from "os";
import {
  initDb,
  findUserByUsername,
  createStudent,
  updateUserStatus,
  getAllStudents,
  getFees,
  addFee,
  deleteFee,
  findFeeById,
  getPayments,
  getPaymentsForUser,
  getUnpaidFeesForUser,
  makePayment,
  SESSION_NAME,
} from "./db.js";
import { signToken, publicUser, requireAuth, requireAdmin } from "./auth.js";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

const router = express.Router();

// ---------- Health ----------
router.get("/health", (req, res) => res.json({ ok: true, session: SESSION_NAME }));

// ---------- Auth ----------
router.post("/auth/signup", async (req, res) => {
  const { fullName, matricNumber, faculty, department, password } = req.body || {};
  if (!fullName || !matricNumber || !faculty || !department || !password) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const user = await createStudent({
      fullName: fullName.trim(),
      matricNumber: matricNumber.trim().toUpperCase(),
      faculty,
      department,
      passwordHash,
    });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  const user = findUserByUsername(username.trim());
  if (!user) return res.status(401).json({ error: "No account found with that matric number." });

  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Incorrect password." });

  if (user.role === "student") {
    if (user.status === "pending") {
      return res.status(403).json({
        error: "Your account is awaiting admin approval. Please check back later.",
      });
    }
    if (user.status === "rejected") {
      return res.status(403).json({
        error: "Your account request was declined. Contact the registrar for help.",
      });
    }
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------- Fees ----------
router.get("/fees", requireAuth, (req, res) => {
  res.json({ fees: getFees() });
});

router.post("/fees", requireAuth, requireAdmin, async (req, res) => {
  const { name, amount } = req.body || {};
  if (!name || !amount) return res.status(400).json({ error: "Name and amount are required." });
  const fee = await addFee({ name, amount, session: SESSION_NAME });
  res.status(201).json({ fee });
});

router.delete("/fees/:id", requireAuth, requireAdmin, async (req, res) => {
  await deleteFee(req.params.id);
  res.json({ ok: true });
});

// ---------- Payments (student) ----------
router.get("/payments/me", requireAuth, (req, res) => {
  res.json({ payments: getPaymentsForUser(req.user.id) });
});

router.get("/payments/unpaid", requireAuth, (req, res) => {
  res.json({ fees: getUnpaidFeesForUser(req.user.id) });
});

router.post("/payments/pay", requireAuth, async (req, res) => {
  if (req.user.role !== "student") {
    return res.status(403).json({ error: "Only students can make payments." });
  }
  const { feeId } = req.body || {};
  const fee = findFeeById(feeId);
  if (!fee) return res.status(404).json({ error: "Fee not found." });

  const alreadyPaid = getPaymentsForUser(req.user.id).some((p) => p.feeId === feeId);
  if (alreadyPaid) return res.status(409).json({ error: "This fee has already been paid." });

  const payment = await makePayment(req.user, fee);
  res.status(201).json({ payment });
});

// ---------- Admin ----------
router.get("/students", requireAuth, requireAdmin, (req, res) => {
  res.json({ students: getAllStudents().map(publicUser) });
});

router.patch("/students/:id/status", requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  try {
    const user = await updateUserStatus(req.params.id, status);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get("/payments", requireAuth, requireAdmin, (req, res) => {
  res.json({ payments: getPayments() });
});

app.use("/api", router);

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(nets)) {
    for (const net of iface || []) {
      if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

const PORT = process.env.PORT || 4000;

await initDb();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FUO portal backend running.`);
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const addr of getLanAddresses()) {
    console.log(`  Network:  http://${addr}:${PORT}  <- use this on your phone`);
  }
});
