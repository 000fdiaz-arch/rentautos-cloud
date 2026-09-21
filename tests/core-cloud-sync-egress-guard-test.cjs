const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/app/useCoreCloudSync.ts", "utf8");

assert.match(
  source,
  /\.subscribe\(\(status\)\s*=>\s*\{[\s\S]*?realtimeHealthy\s*=\s*status\s*===\s*"SUBSCRIBED"/,
  "Core sync must track whether its Realtime channel is healthy."
);

assert.match(
  source,
  /if\s*\(!document\.hidden\s*&&\s*!realtimeHealthy\)\s*void reload\(\)/,
  "The periodic fallback must not redownload core data while Realtime is healthy."
);

assert.match(
  source,
  /if\s*\(hasConnected\s*&&\s*!wasHealthy\s*&&\s*!document\.hidden\)\s*void reload\(\)/,
  "Core sync must reconcile once after Realtime reconnects."
);

console.log("Core cloud sync egress guard checks passed.");
