function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasOverdueDebt(row) {
  return row.overdueBalance > 0 || row.overdueInstallments > 0 || row.state === "vencido" || row.state === "critico";
}

function getWhatsAppContactStatus(row, record) {
  if (!hasOverdueDebt(row)) return "sent";
  if (record?.whatsAppMessageSentAt) return "sent";
  if (record?.whatsAppMessageCopiedAt) return "opened";
  if (!row.whatsAppPhone) return "missing";
  return "ready";
}

function getEffectiveStatus(row, statusByClient, closureItemsByClient = {}) {
  const dailyStatus = closureItemsByClient[row.id]?.collectionStatus;
  if (dailyStatus) return dailyStatus;
  const stored = statusByClient[row.id]?.status;
  if (stored === "pending" || stored === "contacted" || stored === "covered" || stored === "route") return stored;
  if (stored === "paid") return "covered";
  if (stored === "route_collection") return "route";
  if (row.totalPending <= 0) return "covered";
  return "pending";
}

function hasRouteReleaseAmount(record) {
  const amount = record?.routeReleaseAmount ?? record?.managementAmount;
  return typeof amount === "number" && amount > 0;
}

function validateClosure(rows, statusByClient) {
  const pendingManagementRows = rows.filter((row) => getEffectiveStatus(row, statusByClient) === "pending");
  const pendingWhatsAppRows = rows.filter((row) => getWhatsAppContactStatus(row, statusByClient[row.id]) !== "sent");
  const routeRowsMissingAmount = rows.filter((row) => getEffectiveStatus(row, statusByClient) === "route" && !hasRouteReleaseAmount(statusByClient[row.id]));
  if (pendingManagementRows.length > 0) return { ok: false, reason: "management", count: pendingManagementRows.length };
  if (pendingWhatsAppRows.length > 0) return { ok: false, reason: "whatsapp", count: pendingWhatsAppRows.length };
  if (routeRowsMissingAmount.length > 0) return { ok: false, reason: "route_amount", count: routeRowsMissingAmount.length };
  return { ok: true };
}

function closeReceivables(rows, statusByClient, date) {
  const validation = validateClosure(rows, statusByClient);
  if (!validation.ok) return { validation, statusByClient };
  const items = rows.map((row) => {
    const statusRecord = statusByClient[row.id];
    return {
      clientId: row.id,
      unitId: row.unitId,
      clientName: row.name,
      lastPaymentDate: row.lastPaymentDate,
      receivableState: row.state,
      totalPending: row.totalPending,
      collectionStatus: getEffectiveStatus(row, statusByClient),
      comment: "",
      autoApplied: false,
      managementType: statusRecord?.managementType,
      managementAmount: statusRecord?.managementAmount,
      managementComment: statusRecord?.managementComment,
      whatsAppMessageCopiedAt: statusRecord?.whatsAppMessageCopiedAt,
      whatsAppMessageSentAt: statusRecord?.whatsAppMessageSentAt
    };
  });
  return {
    validation,
    statusByClient: {},
    closure: {
      date,
      cuts: {
        night: {
          date,
          cutKey: "night",
          cutLabel: "Gestion diaria",
          closedAt: "2026-07-26T22:00:00.000Z",
          actor: "Operador",
          reason: "Gestion diaria de cobranza",
          items
        }
      }
    }
  };
}

const rows = [
  {
    id: "c1",
    unitId: "A-101",
    name: "Cliente Uno",
    lastPaymentDate: "2026-07-20",
    state: "vencido",
    totalPending: 100,
    overdueBalance: 100,
    overdueInstallments: 1,
    whatsAppPhone: "50760000001"
  },
  {
    id: "c2",
    unitId: "B-202",
    name: "Cliente Dos",
    lastPaymentDate: "2026-07-21",
    state: "critico",
    totalPending: 200,
    overdueBalance: 200,
    overdueInstallments: 2,
    whatsAppPhone: "50760000002"
  },
  {
    id: "c3",
    unitId: "C-303",
    name: "Cliente Tres",
    lastPaymentDate: "2026-07-25",
    state: "alDia",
    totalPending: 0,
    overdueBalance: 0,
    overdueInstallments: 0
  }
];

let statusByClient = {
  c1: { status: "pending", comment: "", updatedAt: "2026-07-26T10:00:00.000Z", whatsAppMessageSentAt: "2026-07-26T10:05:00.000Z" },
  c2: { status: "route", comment: "", updatedAt: "2026-07-26T10:00:00.000Z", whatsAppMessageSentAt: "2026-07-26T10:08:00.000Z" }
};
assert(validateClosure(rows, statusByClient).reason === "management", "Debe bloquear si hay gestiones pendientes.");

statusByClient = {
  c1: { status: "contacted", comment: "", updatedAt: "2026-07-26T10:00:00.000Z" },
  c2: { status: "route", comment: "", updatedAt: "2026-07-26T10:00:00.000Z", whatsAppMessageSentAt: "2026-07-26T10:08:00.000Z" }
};
assert(validateClosure(rows, statusByClient).reason === "whatsapp", "Debe bloquear si hay WhatsApp pendiente.");

statusByClient = {
  c1: { status: "contacted", comment: "", updatedAt: "2026-07-26T10:00:00.000Z", whatsAppMessageSentAt: "2026-07-26T10:05:00.000Z" },
  c2: { status: "route", comment: "", updatedAt: "2026-07-26T10:00:00.000Z", whatsAppMessageSentAt: "2026-07-26T10:08:00.000Z" }
};
assert(validateClosure(rows, statusByClient).reason === "route_amount", "Debe bloquear ruta sin monto minimo.");

statusByClient = {
  c1: { status: "contacted", comment: "", updatedAt: "2026-07-26T10:00:00.000Z", whatsAppMessageSentAt: "2026-07-26T10:05:00.000Z" },
  c2: {
    status: "route",
    comment: "",
    updatedAt: "2026-07-26T10:00:00.000Z",
    managementType: "solo_cobrar",
    managementAmount: 200,
    managementComment: "Ruta",
    routeReleaseAmount: 200,
    whatsAppMessageSentAt: "2026-07-26T10:08:00.000Z"
  }
};
const result = closeReceivables(rows, statusByClient, "2026-07-26");
assert(result.validation.ok, "Debe permitir cierre cuando no hay bloqueos.");
assert(Object.keys(result.statusByClient).length === 0, "Debe limpiar estados vivos despues del cierre.");
assert(result.closure.cuts.night.items.length === rows.length, "Debe guardar snapshot con todas las filas.");
const routeItem = result.closure.cuts.night.items.find((item) => item.clientId === "c2");
assert(routeItem.collectionStatus === "route", "Historial debe conservar estado de ruta.");
assert(routeItem.managementAmount === 200, "Historial debe conservar monto de ruta.");
assert(routeItem.whatsAppMessageSentAt, "Historial debe conservar auditoria de WhatsApp enviado.");

console.log("OK receivables closure flow: bloqueos, cierre, limpieza e historial validados.");
