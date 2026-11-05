import { createHash } from "node:crypto";
import { CFG } from "./data.mjs";

const attempts = new Map();
const WINDOW_MS = 60_000;
const LIMIT = 25;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    }
  });
}

function clientKey(request) {
  return request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function allowed(key) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= LIMIT;
}

function buildAssignments() {
  const seed = CFG.seed;
  function seedFn(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }
  function shuffle(array, random) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const random = seedFn(seed);
  const seniorCount = CFG.seniors.length;
  const juniorCount = CFG.juniors.length;
  const indexes = [...Array(seniorCount).keys()];
  const extra = shuffle(indexes, random);
  let slots = indexes.concat(extra);
  while (slots.length < juniorCount) slots = slots.concat(shuffle(indexes, random));
  slots = shuffle(slots.slice(0, Math.max(juniorCount, seniorCount)), random);
  return CFG.juniors.map((_, i) => slots[i]);
}

const assignments = buildAssignments();

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!allowed(clientKey(request))) return json({ error: "ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" }, 429);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, 400); }

  const studentId = typeof body?.studentId === "string"
    ? body.studentId.replace(/\s/g, "").toLowerCase()
    : "";
  if (!/^[a-z0-9]{4,24}$/.test(studentId)) {
    return json({ error: "กรุณาตรวจสอบรหัสนักศึกษาอีกครั้ง" }, 400);
  }

  const hash = createHash("sha256").update("bu-tech:" + studentId, "utf8").digest("hex");
  const index = CFG.jh.findIndex((hashes) => hashes.includes(hash));
  if (index < 0) return json({ error: "ไม่พบรหัสนักศึกษานี้ ตรวจสอบอีกครั้งนะ" }, 404);

  const seniorIndex = assignments[index];
  const senior = CFG.seniors[seniorIndex];
  const siblingCount = assignments.filter((value) => value === seniorIndex).length - 1;

  return json({
    juniorName: CFG.juniors[index],
    hint: senior.hint,
    siblingMessage: siblingCount
      ? `พี่คนนี้มีน้องรหัสอีก ${siblingCount} คน`
      : "พี่คนนี้มีน้องรหัสคนเดียว คือน้อง!"
  });
};
