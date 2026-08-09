const fs = require("fs");
const path = require("path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const pageSource = fs.readFileSync(path.join(root, "src/pages/ReceivablesPage.tsx"), "utf8");
const cloudSource = fs.readFileSync(path.join(root, "src/cloud/paymentCloudData.ts"), "utf8");
const migrationSource = fs.readFileSync(
  path.join(root, "supabase/51-receivables-latest-payment-active-client.sql"),
  "utf8"
);
const readRpcSource = fs.readFileSync(
  path.join(root, "supabase/52-receivables-latest-payments-read-rpc.sql"),
  "utf8"
);

assert(
  pageSource.includes('.filter((client) => client.status !== "archivado" && !client.archivedAt)'),
  "Cuentas por cobrar debe consultar el ultimo pago de todos los clientes activos."
);
assert(
  pageSource.includes("setSupplementalLastPayments(latestPayments)"),
  "La consulta debe reemplazar el cache para retirar pagos eliminados o corregidos."
);
assert(
  pageSource.includes("[clients, dataOwnerUserId, payments]"),
  "El cache debe refrescarse cuando cambien clientes o pagos."
);
assert(
  pageSource.includes("retryTimer = window.setTimeout(loadLatestPayments"),
  "La consulta debe recuperarse automaticamente de un timeout transitorio."
);
assert(
  cloudSource.includes('.in("data->>clientUnit", unitIds)'),
  "La consulta de respaldo debe recuperar pagos historicos por unidad."
);
assert(
  cloudSource.includes('client.rpc("latest_payments_for_active_receivables"'),
  "La pantalla debe consultar el resumen mediante una RPC compacta."
);
assert(
  cloudSource.includes("if (loadedFromRpc) return [...latestByClientId.values()]") &&
    cloudSource.includes("if (loadedFromLatestPaymentsTable) return [...latestByClientId.values()]"),
  "Una respuesta autoritativa no debe descartarse por buscar clientes que legitimamente no tienen pagos."
);
assert(
  cloudSource.includes("paymentMatchesTargetIdentity(payment, item)"),
  "Los pagos recuperados por unidad deben validar la identidad del cliente."
);
assert(
  migrationSource.includes("after insert or update or delete on public.payments_cloud"),
  "La tabla auxiliar debe reaccionar a cambios de pagos."
);
assert(
  migrationSource.includes("after insert or update or delete on public.clients_cloud") &&
    migrationSource.includes("if tg_op = 'UPDATE'") &&
    migrationSource.includes("return new;"),
  "La tabla auxiliar debe reaccionar a cambios de identidad del cliente sin recalcular por cambios financieros."
);
assert(
  migrationSource.includes("receivable_payment_matches_client"),
  "La reconstruccion debe validar unidad e identidad para pagos historicos."
);
assert(
  migrationSource.includes("perform public.rebuild_latest_payment_for_client(v_client.user_id, v_client.id)"),
  "La migracion debe reconstruir el resumen para los clientes activos existentes."
);
assert(
  readRpcSource.includes("public.can_access_owner_data(p_owner_user_id)"),
  "La lectura compacta debe respetar el acceso al propietario de los datos."
);
assert(
  readRpcSource.includes("return query") && !readRpcSource.includes("and public.can_access_owner_data(p_owner_user_id)"),
  "El permiso debe validarse una sola vez antes de leer el resumen para evitar timeouts."
);
assert(
  readRpcSource.includes("grant execute on function public.latest_payments_for_active_receivables(uuid) to authenticated"),
  "Los usuarios autenticados deben poder ejecutar la consulta segura."
);

console.log("OK ultimo pago: cache activo, identidad historica, refresco y respaldo validados.");
