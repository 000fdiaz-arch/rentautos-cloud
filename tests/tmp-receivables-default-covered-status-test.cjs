function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasActiveOperationalClient(row, operationalStatus = row.operationalStatus ?? "activo") {
  return row.hasActiveClient && operationalStatus.trim().toLowerCase() === "activo";
}

function shouldDefaultToCovered(row, operationalStatus = row.operationalStatus ?? "activo") {
  return hasActiveOperationalClient(row, operationalStatus) && row.totalPending <= 0;
}

function defaultStatus(row) {
  return shouldDefaultToCovered(row) ? "covered" : "unassigned";
}

assert(
  defaultStatus({ hasActiveClient: true, operationalStatus: "activo", totalPending: 0 }) === "covered",
  "Unidad activa con cliente activo y sin saldo debe quedar Cubierto."
);

assert(
  defaultStatus({ hasActiveClient: false, operationalStatus: "libre", totalPending: 0 }) === "unassigned",
  "Unidad sin cliente no debe quedar Cubierto aunque no tenga saldo."
);

assert(
  defaultStatus({ hasActiveClient: true, operationalStatus: "taller", totalPending: 0 }) === "unassigned",
  "Unidad con carro no activo no debe quedar Cubierto aunque no tenga saldo."
);

assert(
  defaultStatus({ hasActiveClient: true, operationalStatus: "activo", totalPending: 125 }) === "unassigned",
  "Unidad activa con saldo pendiente debe quedar Por asignar si no tiene gestion manual."
);

console.log("OK receivables default covered status: cliente activo, carro activo y saldo cero requerido.");
