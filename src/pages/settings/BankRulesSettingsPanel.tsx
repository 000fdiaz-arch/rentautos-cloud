import { useMemo, useState, type FormEvent } from "react";
import type { BankRule } from "../../types";

type Props = {
  bankRules: BankRule[];
  onChange: (next: BankRule[]) => void;
};

const EMPTY_FORM = { accountNumber: "", accountName: "", groupCode: "" };

export default function BankRulesSettingsPanel({ bankRules, onChange }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const activeRules = useMemo(() => bankRules.filter((rule) => rule.active).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)), [bankRules]);
  const inactiveRules = useMemo(() => bankRules.filter((rule) => !rule.active).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [bankRules]);

  function reset(): void {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setErrors([]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const accountNumber = form.accountNumber.replace(/\D+/g, "");
    const accountName = form.accountName.trim();
    const groupCode = form.groupCode.trim().toUpperCase();
    const nextErrors: string[] = [];
    if (!accountNumber) nextErrors.push("El numero de cuenta es obligatorio.");
    if (!groupCode) nextErrors.push("El grupo es obligatorio.");
    if (bankRules.some((rule) => rule.active && rule.accountNumber === accountNumber && rule.id !== editingId)) {
      nextErrors.push("Ya existe una regla activa para ese numero de cuenta.");
    }
    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }
    const now = new Date().toISOString();
    if (editingId) {
      onChange(bankRules.map((rule) => rule.id === editingId ? { ...rule, accountNumber, accountName: accountName || undefined, groupCode, active: true, updatedAt: now } : rule));
    } else {
      onChange([{ id: crypto.randomUUID(), accountNumber, accountName: accountName || undefined, groupCode, active: true, createdAt: now, updatedAt: now }, ...bankRules]);
    }
    reset();
  }

  function edit(rule: BankRule): void {
    setForm({ accountNumber: rule.accountNumber, accountName: rule.accountName ?? "", groupCode: rule.groupCode });
    setEditingId(rule.id);
    setErrors([]);
  }

  function toggle(ruleId: string, active: boolean): void {
    const updatedAt = new Date().toISOString();
    onChange(bankRules.map((rule) => rule.id === ruleId ? { ...rule, active, updatedAt } : rule));
    if (!active && editingId === ruleId) reset();
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2>Regla bancaria</h2></div>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>Nombre de la cuenta (opcional)<input type="text" placeholder="Ej. Cuenta principal" maxLength={60} value={form.accountName} onChange={(event) => setForm((current) => ({ ...current, accountName: event.target.value }))} /></label>
          <label>Numero de cuenta<input type="text" inputMode="numeric" placeholder="Ej. 3380008048" value={form.accountNumber} onChange={(event) => setForm((current) => ({ ...current, accountNumber: event.target.value.replace(/\D+/g, "") }))} /></label>
          <label>Grupo<input type="text" placeholder="Ej. T" maxLength={8} value={form.groupCode} onChange={(event) => setForm((current) => ({ ...current, groupCode: event.target.value.trim().toUpperCase() }))} /></label>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button type="submit" className="button primary">{editingId ? "Guardar cambios" : "Agregar regla"}</button>
            {editingId && <button type="button" className="button ghost" onClick={reset}>Cancelar</button>}
          </div>
        </form>
        {errors.length > 0 && <ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table><thead><tr><th>Nombre</th><th>Numero de cuenta</th><th>Grupo</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>{activeRules.length === 0 ? <tr><td colSpan={5} className="empty" style={{ textAlign: "center" }}>No hay reglas bancarias activas.</td></tr> : activeRules.map((rule) => (
              <tr key={rule.id}><td><strong>{rule.accountName || "Sin nombre"}</strong></td><td><code>{rule.accountNumber}</code></td><td><strong>Grupo {rule.groupCode}</strong></td><td><span className="badge-sim">Activa</span></td><td className="actions-cell"><button type="button" className="button ghost small" onClick={() => edit(rule)}>Editar</button><button type="button" className="button danger small" onClick={() => toggle(rule.id, false)}>Desactivar</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      {inactiveRules.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Reglas desactivadas</h2></div>
          <div className="table-scroll" style={{ marginTop: 10 }}><table><thead><tr><th>Nombre</th><th>Numero de cuenta</th><th>Grupo</th><th>Actualizado</th><th>Acciones</th></tr></thead>
            <tbody>{inactiveRules.map((rule) => <tr key={rule.id}><td>{rule.accountName || "Sin nombre"}</td><td><code>{rule.accountNumber}</code></td><td>Grupo {rule.groupCode}</td><td>{new Date(rule.updatedAt).toLocaleString("es-PA")}</td><td className="actions-cell"><button type="button" className="button ghost small" onClick={() => toggle(rule.id, true)}>Reactivar</button></td></tr>)}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
