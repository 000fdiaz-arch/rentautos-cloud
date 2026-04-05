import { parseBankCsv } from "../csv";
import type { BankRow, BankRowState, Client, Movement } from "../types";
import { getTodayIsoDate } from "../app/constants";
import { createId } from "./ids";
import { parseDateValue } from "./format";

function findClientMatch(client: Client, text: string) {
  const normalizedText = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const tags = [client.code, client.name, client.alias, ...client.bankTags].map((tag) =>
    tag
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim(),
  );

  return tags.some((tag) => tag.length > 0 && normalizedText.includes(tag));
}

function findSuggestedPayment(
  clientId: string,
  amount: number,
  date: string,
  movements: Movement[],
) {
  const targetDate = parseDateValue(date);

  return movements.find((movement) => {
    if (movement.clientId !== clientId || movement.type !== "abono" || movement.bankReference) {
      return false;
    }

    if (Math.abs(movement.amount - amount) > 0.009) {
      return false;
    }

    const movementDate = parseDateValue(movement.date);

    if (!movementDate || !targetDate) {
      return true;
    }

    const dayDiff =
      Math.abs(targetDate.getTime() - movementDate.getTime()) / (1000 * 60 * 60 * 24);
    return dayDiff <= 5;
  });
}

export function buildBankRows(
  text: string,
  clients: Client[],
  movements: Movement[],
  today = getTodayIsoDate(),
) {
  return parseBankCsv(text).map((row) => {
    const matchedClient = clients.find((client) =>
      findClientMatch(client, `${row.clientLabel} ${row.reference}`),
    );
    const suggestedMovement = matchedClient
      ? findSuggestedPayment(matchedClient.id, Math.abs(row.amount), row.date || today, movements)
      : undefined;

    let status: BankRowState = "sin-asignar";
    let notes = "No pude encontrar el cliente en automatico.";

    if (row.amount < 0) {
      status = "revisar";
      notes = "El monto es negativo. Revisa si es una comision u otro cargo del banco.";
    } else if (matchedClient && suggestedMovement) {
      status = "coincide";
      notes = "Ya existe un abono parecido. Puedes conciliarlo sin volver a escribirlo.";
    } else if (matchedClient) {
      status = "revisar";
      notes = "Reconoci el cliente, pero este pago aun no esta en movimientos.";
    }

    return {
      ...row,
      id: createId("bank"),
      status,
      matchedClientId: matchedClient?.id,
      suggestedMovementId: suggestedMovement?.id,
      notes,
    };
  });
}

export function assignBankRowClient(
  bankRows: BankRow[],
  rowId: string,
  clientId: string,
): BankRow[] {
  return bankRows.map((row) => {
    if (row.id !== rowId) {
      return row;
    }

    return {
      ...row,
      matchedClientId: clientId || undefined,
      status: (clientId ? "revisar" : "sin-asignar") as BankRowState,
      suggestedMovementId: undefined,
      notes: clientId
        ? "Cliente elegido manualmente. Ya puedes registrar el abono."
        : "No hay cliente asignado aun.",
    };
  });
}

export function markBankRowProcessed(bankRows: BankRow[], rowId: string): BankRow[] {
  return bankRows.map((row) =>
    row.id === rowId
      ? {
          ...row,
          status: "procesado",
          notes: "Este movimiento ya fue aplicado a la cuenta del cliente.",
        }
      : row,
  );
}

export function applyBankRowToMovements(
  row: BankRow,
  movements: Movement[],
  today = getTodayIsoDate(),
): Movement[] {
  if (!row.matchedClientId) {
    return movements;
  }

  if (row.suggestedMovementId) {
    return movements.map((movement) =>
      movement.id === row.suggestedMovementId
        ? {
            ...movement,
            source: "bank",
            bankReference: row.reference,
            reconciledAt: today,
          }
        : movement,
    );
  }

  const nextMovement: Movement = {
    id: createId("mov"),
    clientId: row.matchedClientId,
    date: row.date || today,
    type: "abono",
    amount: Math.abs(row.amount),
    description: `Abono importado desde banco (${row.reference || "sin ref."})`,
    source: "bank",
    bankReference: row.reference || undefined,
    reconciledAt: today,
  };

  return [nextMovement, ...movements];
}
