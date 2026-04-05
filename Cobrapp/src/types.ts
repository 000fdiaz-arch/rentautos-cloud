export type MovementType = "cargo" | "abono" | "ajuste";

export type ClientState = "al-dia" | "pendiente" | "atrasado";

export type MovementSource = "manual" | "bank" | "system";

export type BankRowState = "coincide" | "revisar" | "sin-asignar" | "procesado";

export interface Client {
  id: string;
  code: string;
  name: string;
  alias: string;
  phone: string;
  notes: string;
  bankTags: string[];
  createdAt: string;
}

export interface NewClientInput {
  name: string;
  alias: string;
  phone: string;
  notes: string;
}

export interface Movement {
  id: string;
  clientId: string;
  date: string;
  type: MovementType;
  amount: number;
  description: string;
  source: MovementSource;
  bankReference?: string;
  reconciledAt?: string;
}

export interface NewMovementInput {
  date: string;
  type: MovementType;
  amount: number;
  description: string;
}

export interface ParsedBankRow {
  date: string;
  reference: string;
  clientLabel: string;
  amount: number;
}

export interface BankRow extends ParsedBankRow {
  id: string;
  status: BankRowState;
  matchedClientId?: string;
  suggestedMovementId?: string;
  notes: string;
}
