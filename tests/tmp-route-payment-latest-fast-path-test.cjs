const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "65-route-payment-latest-fast-path.sql"),
  "utf8"
);
const paymentCloudData = fs.readFileSync(
  path.join(root, "src", "cloud", "paymentCloudData.ts"),
  "utf8"
);

assert.match(migration, /tg_op = 'INSERT'[\s\S]*new\.data->>'source' = 'route'/);
assert.match(migration, /insert into public\.latest_payments_by_client_cloud/);
assert.match(migration, /on conflict \(user_id, client_id\) do update/);
assert.match(migration, /for v_client_id in[\s\S]*rebuild_latest_payment_for_client/);
assert.doesNotMatch(migration, /update public\.clients_cloud/);
assert.match(
  paymentCloudData,
  /withCloudRetry\(async \(\) => \{[\s\S]*register_client_payment_deltas[\s\S]*if \(error\) throw error;/
);

console.log("OK route payment latest fast path");
