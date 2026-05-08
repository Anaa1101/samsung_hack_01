import { db } from "../src/db.js";

const rows = db.prepare("SELECT kind, payload, ts FROM audit_log ORDER BY id DESC LIMIT 10").all();
console.log(JSON.stringify(rows, null, 2));
