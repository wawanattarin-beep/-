import { timingSafeEqual } from "node:crypto";
import { CFG } from "./data.mjs";

const attempts = new Map();
const WINDOW_MS = 15 * 60_000;
const LIMIT = 5;

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
  const random = seedFn(CFG.seed);
  const indexes = [...Array(CFG.seniors.length).keys()];
  const extra = shuffle(indexes, random);
  let slots = indexes.concat(extra);
  while (slots.length < CFG.juniors.length) slots = slots.concat(shuffle(indexes, random));
  slots = shuffle(slots.slice(0, Math.max(CFG.juniors.length, CFG.seniors.length)), random);
  return CFG.juniors.map((_, i) => slots[i]);
}

const assignments = buildAssignments();

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!allowed(clientKey(request))) return json({ error: "ลองรอสักครู่ก่อนแล้วค่อยเข้าสู่ระบบอีกครั้ง" }, 429);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, 400); }

  const expected = process.env.ADMIN_PASSWORD || "";
  const supplied = typeof body?.password === "string" ? body.password : "";
  if (!expected || !supplied || expected.length > 256 || supplied.length > 256) {
    return json({ error: "ยังไม่ได้ตั้งค่ารหัสผ่านทีมงานใน Netlify" }, 503);
  }

  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  const valid = a.length === b.length && timingSafeEqual(a, b);
  if (!valid) return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);

  const rows = CFG.juniors.map((junior, i) => ({
    junior,
    senior: CFG.seniors[assignments[i]]?.name || "ไม่พบข้อมูล"
  }));
  return json({ rows });
};
