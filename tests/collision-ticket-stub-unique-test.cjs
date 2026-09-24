const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const operations = fs.readFileSync(path.join(root, "src", "cloud", "operationsCloudData.ts"), "utf8");
const intake = fs.readFileSync(path.join(root, "src", "pages", "IncidentIntakeForm.tsx"), "utf8");
const collisions = fs.readFileSync(path.join(root, "src", "pages", "CollisionsPage.tsx"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20260922000100_collision_ticket_stub_unique.sql"), "utf8");

assert.match(operations, /class DuplicateCollisionTicketStubError/, "Debe exponer un error específico para colillas duplicadas.");
assert.ok(operations.includes('replace(/[\\s-]+/g, "")'), "La colilla debe compararse sin espacios ni guiones.");
assert.match(operations, /from\("collision_cases_cloud"\)[\s\S]*select\("id,data"\)[\s\S]*DuplicateCollisionTicketStubError/, "La app debe detectar la colilla duplicada antes de guardar.");
assert.match(intake, /DuplicateCollisionTicketStubError/, "El alta unificada debe mostrar el error de colilla duplicada.");
assert.match(collisions, /DuplicateCollisionTicketStubError/, "La pantalla judicial debe mostrar el error de colilla duplicada al crear o editar.");
assert.match(migration, /prevent_duplicate_collision_ticket_stub/, "La base debe tener una protección permanente.");
assert.match(migration, /pg_advisory_xact_lock/, "La protección debe cubrir guardados simultáneos.");
assert.match(migration, /collision_cases_cloud_unique_ticket_stub/, "Debe instalarse el trigger de unicidad de colilla.");
assert.match(migration, /tg_op = 'UPDATE'/, "Los expedientes duplicados existentes deben poder corregirse sin bloquear otros cambios.");

console.log("OK unicidad de colilla: validación en app y base de datos.");
