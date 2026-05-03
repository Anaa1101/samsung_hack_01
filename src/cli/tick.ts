import { runTickOnce } from "../scheduler.js";

await runTickOnce();
console.log("[cli] tick complete");
process.exit(0);
