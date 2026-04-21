import { useMemo, useState, type FormEvent } from "react";
import type { BankRule } from "../types";

type FormState = {
  accountNumber: string;
  groupCode: string;
};

type Props = {
  bankRules: BankRule[];
  onBankRulesChange: (next: BankRule[]) => void;
};

const initialForm: FormState = {
  accountNumber: "",
  groupCode: ""
};

function normalizeAccountNumber(value: string): string {
  return value.replace(/\D+/g, "");
}

function normalizeGroupCode(value: string): string {
  return value.trim().toUpperCase();
}

export default function SettingsPage({ bankRules, onBankRulesChange }: Props) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const activeRules = useMemo(
    () => bankRules.filter((r) => r.active).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)),
    [bankRules]
  );

  const inactiveRules = useMemo(
    () => bankRules.filter((r) => !r.active).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [bankRules]
  );

  function resetForm(): void {
    setForm(initialForm);
    setEditingId(null);
    setErrors([]);
  }

  function validate(nextForm: FormState, currentEditingId: string | null): string[] {
    const messages: string[] = [];
    const accountNumber = normalizeAccountNumber(nextForm.accountNumber);
    const groupCode = normalizeGroupCode(nextForm.groupCode);

    if (!accountNumber) messages.push("El numero de cuenta es obligatorio.");
    if (!groupCode) messages.push("El grupo es obligatorio.");

    const duplicate = bankRules.find(
      (rule) =>
        rule.active &&
        rule.id !== currentEditingId &&
        normalizeAccountNumber(rule.accountNumber) === accountNumber
    );
    if (duplicate) {
      messages.push("Ya existe una regla activa para ese numero de cuenta.");
    }

    return messages;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const validationErrors = validate(form, editingId);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    const now = new Date().toISOString();
    const accountNumber = normalizeAccountNumber(form.accountNumber);
    const groupCode = normalizeGroupCode(form.groupCode);

    if (editingId) {
      const next = bankRules.map((rule) =>
        rule.id === editingId
          ? { ...rule, accountNumber, groupCode, updatedAt: now, active: true }
          : rule
      );
      onBankRulesChange(next);
    } else {
      const nextRule: BankRule = {
        id: crypto.randomUUID(),
        accountNumber,
        groupCode,
        active: true,
        createdAt: now,
        updatedAt: now
      };
      onBankRulesChange([nextRule, ...bankRules]);
    }

    resetForm();
  }

  function handleEdit(rule: BankRule): void {
    setForm({ accountNumber: rule.accountNumber, groupCode: rule.groupCode });
    setEditingId(rule.id);
    setErrors([]);
  }

  function handleToggleActive(ruleId: string, active: boolean): void {
    const now = new Date().toISOString();
    const next = bankRules.map((rule) =>
      rule.id === ruleId ? { ...rule, active, updatedAt: now } : rule
    );
    onBankRulesChange(next);
    if (!active && editingId === ruleId) {
      resetForm();
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Regla bancaria</h2>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Numero de cuenta
            <input
              type="text"
              inputMode="numeric"
              placeholder="Ej. 3380008048"
              value={form.accountNumber}
              onChange={(e) => setForm((prev) => ({ ...prev, accountNumber: normalizeAccountNumber(e.target.value) }))}
            />
          </label>

          <label>
            Grupo
            <input
              type="text"
              placeholder="Ej. T"
              maxLength={8}
              value={form.groupCode}
              onChange={(e) => setForm((prev) => ({ ...prev, groupCode: normalizeGroupCode(e.target.value) }))}
            />
          </label>

          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button type="submit" className="button primary">
              {editingId ? "Guardar cambios" : "Agregar regla"}
            </button>
            {editingId && (
              <button type="button" className="button ghost" onClick={resetForm}>
                Cancelar
              </button>
            )}
          </div>
        </form>

        {errors.length > 0 && (
          <ul className="error-list">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Numero de cuenta</th>
                <th>Grupo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {activeRules.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                    No hay reglas bancarias activas.
                  </td>
                </tr>
              ) : (
                activeRules.map((rule) => (
                  <tr key={rule.id}>
                    <td><code>{rule.accountNumber}</code></td>
                    <td><strong>Grupo {rule.groupCode}</strong></td>
                    <td><span className="badge-sim">Activa</span></td>
                    <td className="actions-cell">
                      <button type="button" className="button ghost small" onClick={() => handleEdit(rule)}>
                        Editar
                      </button>
                      <button type="button" className="button danger small" onClick={() => handleToggleActive(rule.id, false)}>
                        Desactivar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {inactiveRules.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Reglas desactivadas</h2>
          </div>
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Numero de cuenta</th>
                  <th>Grupo</th>
                  <th>Actualizado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {inactiveRules.map((rule) => (
                  <tr key={rule.id}>
                    <td><code>{rule.accountNumber}</code></td>
                    <td>Grupo {rule.groupCode}</td>
                    <td>{new Date(rule.updatedAt).toLocaleString("es-PA")}</td>
                    <td className="actions-cell">
                      <button type="button" className="button ghost small" onClick={() => handleToggleActive(rule.id, true)}>
                        Reactivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
