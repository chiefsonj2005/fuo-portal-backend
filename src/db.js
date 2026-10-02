import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "..", "data", "db.json");

const SESSION_NAME = "2025/2026";

// ---------- Storage backend ----------
// Two modes, chosen automatically:
//   - Upstash Redis (persistent, survives restarts/redeploys) when
//     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set — this is
//     what makes the data survive on free hosts like Render, whose local
//     disk gets wiped on every restart.
//   - A local JSON file otherwise — unchanged behavior for local dev.
// Everything above this point in the file is storage plumbing; the actual
// business logic below never needs to know which mode is active.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);
const REDIS_KEY = "fuo_portal_db";

async function redisLoad() {
  const res = await fetch(`${REDIS_URL}/get/${REDIS_KEY}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Redis GET failed: ${res.status}`);
  const { result } = await res.json();
  return result ? JSON.parse(result) : null;
}

async function redisSave(data) {
  // Upstash's REST API stores the raw POST body as the value (see
  // https://upstash.com/docs/redis/features/restapi#json-or-binary-value) —
  // so the body here is the JSON *text* itself, not a JSON-encoded string.
  const res = await fetch(`${REDIS_URL}/set/${REDIS_KEY}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${res.status}`);
}

function fileLoad() {
  if (!fs.existsSync(DB_FILE)) return null;
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  return raw ? JSON.parse(raw) : null;
}

// A simple in-process write queue keeps concurrent writes from clobbering
// each other in file mode.
let writeQueue = Promise.resolve();

function fileSave(data) {
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), (err) => {
          if (err) reject(err);
          else resolve();
        });
      })
  );
  return writeQueue;
}

async function loadData() {
  return USE_REDIS ? redisLoad() : fileLoad();
}

async function saveData(data) {
  return USE_REDIS ? redisSave(data) : fileSave(data);
}

function seedFees() {
  return [
    { id: "fee-1", name: "STUDENTS INDUSTRIAL WORK EXPERIENCE", amount: 5000, session: SESSION_NAME },
    { id: "fee-2", name: "PORTAL CHARGE", amount: 5000, session: SESSION_NAME },
    { id: "fee-3", name: "FACULTY DUES", amount: 5000, session: SESSION_NAME },
    { id: "fee-4", name: "SUG/FSA/DSA UNION DUES", amount: 3500, session: SESSION_NAME },
    { id: "fee-5", name: "CAMPUS COMMUNICATIONS CUG", amount: 3000, session: SESSION_NAME },
    { id: "fee-6", name: "PLAGIARISM TEST", amount: 2000, session: SESSION_NAME },
    { id: "fee-7", name: "LIBRARY FEES", amount: 10000, session: SESSION_NAME },
    { id: "fee-8", name: "ICT CHARGE", amount: 4000, session: SESSION_NAME },
  ];
}

// In-memory cache, populated once at startup and persisted on every
// mutation. `initDb()` must be awaited before the server starts handling
// requests.
let cache = null;

export async function initDb() {
  let data = await loadData();
  if (!data) {
    const adminUsername = process.env.ADMIN_USERNAME || "Chiefson.Favour";
    const adminPassword = process.env.ADMIN_PASSWORD || "Justt_Jay170205";
    data = {
      users: [
        {
          id: "admin-1",
          role: "admin",
          username: adminUsername,
          fullName: "System Administrator",
          passwordHash: bcrypt.hashSync(adminPassword, 10),
        },
      ],
      fees: seedFees(),
      payments: [],
    };
    await saveData(data);
  } else {
    // Ensure fields added in later versions exist even for older data.
    let changed = false;
    if (!data.fees) {
      data.fees = seedFees();
      changed = true;
    }
    if (!data.payments) {
      data.payments = [];
      changed = true;
    }
    if (changed) await saveData(data);
  }
  cache = data;
  console.log(`Data store: ${USE_REDIS ? "Upstash Redis (persistent)" : "local file (data/db.json)"}`);
  return cache;
}

function persist() {
  return saveData(cache);
}

// ---------- Users ----------

export function getUsers() {
  return cache.users;
}

export function findUserById(id) {
  return cache.users.find((u) => u.id === id) || null;
}

export function findUserByUsername(username) {
  return (
    cache.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    ) || null
  );
}

export async function createStudent({ fullName, matricNumber, faculty, department, passwordHash }) {
  if (findUserByUsername(matricNumber)) {
    throw new Error("An account with this matric number already exists.");
  }
  const user = {
    id: `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    role: "student",
    username: matricNumber,
    matricNumber,
    fullName,
    faculty,
    department,
    passwordHash,
    status: "pending",
    level: "400 Level",
    session: SESSION_NAME,
    createdAt: new Date().toISOString(),
  };
  cache.users.push(user);
  await persist();
  return user;
}

export async function updateUserStatus(userId, status) {
  const user = findUserById(userId);
  if (!user) throw new Error("User not found.");
  user.status = status;
  await persist();
  return user;
}

export function getAllStudents() {
  return cache.users.filter((u) => u.role === "student");
}

// ---------- Fees ----------

export function getFees() {
  return cache.fees;
}

export async function addFee({ name, amount, session }) {
  const fee = {
    id: `fee-${Date.now()}`,
    name: String(name).toUpperCase(),
    amount: Number(amount),
    session: session || SESSION_NAME,
  };
  cache.fees.push(fee);
  await persist();
  return fee;
}

export async function deleteFee(feeId) {
  cache.fees = cache.fees.filter((f) => f.id !== feeId);
  await persist();
}

export function findFeeById(feeId) {
  return cache.fees.find((f) => f.id === feeId) || null;
}

// ---------- Payments ----------

export function getPayments() {
  return cache.payments;
}

export function getPaymentsForUser(userId) {
  return cache.payments
    .filter((p) => p.userId === userId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function getUnpaidFeesForUser(userId) {
  const paidFeeIds = new Set(getPaymentsForUser(userId).map((p) => p.feeId));
  return cache.fees.filter((f) => !paidFeeIds.has(f.id));
}

function numberToWords(num) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function chunk(n) {
    let s = "";
    if (n >= 100) {
      s += ones[Math.floor(n / 100)] + " Hundred ";
      n %= 100;
    }
    if (n >= 20) {
      s += tens[Math.floor(n / 10)] + " ";
      n %= 10;
    }
    if (n > 0) s += ones[n] + " ";
    return s.trim();
  }

  if (num === 0) return "Zero";
  let result = "";
  const millions = Math.floor(num / 1000000);
  const thousands = Math.floor((num % 1000000) / 1000);
  const rest = num % 1000;
  if (millions) result += chunk(millions) + " Million ";
  if (thousands) result += chunk(thousands) + " Thousand ";
  if (rest) result += chunk(rest);
  return result.trim();
}

function genRef() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `${y}${m}${d}${rand}`;
}

export async function makePayment(user, fee) {
  const payment = {
    id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId: user.id,
    feeId: fee.id,
    feeName: fee.name,
    amount: fee.amount,
    session: fee.session,
    date: new Date().toISOString(),
    receiptNo: genRef(),
    paymentRef: genRef(),
    amountInWords: numberToWords(fee.amount) + " Naira Only",
    student: {
      matricNumber: user.matricNumber,
      fullName: user.fullName,
      faculty: user.faculty,
      department: user.department,
    },
  };
  cache.payments.push(payment);
  await persist();
  return payment;
}

export { SESSION_NAME };
