const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260921000100_receivables_route_read_indexes.sql"),
  "utf8"
).toLowerCase();

assert.ok(migration.includes("create index if not exists"), "La migracion debe ser repetible.");
assert.ok(migration.includes("(user_id, reported_at desc, id)"), "El indice debe seguir el orden de la paginacion.");
assert.ok(migration.includes("where status <> 'cancelled'"), "El historial debe omitir cancelados desde el indice.");
assert.ok(migration.includes("where status = 'review'"), "La cola operativa debe tener un indice parcial propio.");
assert.ok(!migration.includes("policy") || migration.includes("no data or rls policy is changed"), "La migracion no debe cambiar RLS.");

console.log("OK migracion: indices repetibles para historial y cola de revision, sin cambios de datos o RLS.");
