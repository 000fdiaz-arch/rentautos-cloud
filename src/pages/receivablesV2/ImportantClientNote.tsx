import { useState } from "react";

export function ImportantClientNote({ unit, name, value, disabled, onSave }: {
  unit: string; name: string; value: string; disabled: boolean; onSave: (note: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!value.trim() && !editing) return <div className="cxc-important-note-add">
    <button type="button" className="button ghost small" disabled={disabled}
      aria-label={`Agregar nota importante a ${unit}`}
      onClick={() => { setDraft(""); setError(""); setEditing(true); }}>Agregar nota</button>
  </div>;
  return <aside className="cxc-important-note" aria-label={`Nota importante de ${unit}`}>
    <div className="cxc-important-note-heading"><strong>Nota importante · {unit} · {name}</strong>
      {!editing && <button type="button" className="button ghost small" disabled={disabled}
        onClick={() => { setDraft(value); setError(""); setEditing(true); }}>{value ? "Editar nota" : "Agregar nota"}</button>}
    </div>
    {value && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "6px 0" }}>{value}</p>}
    {editing && <form onSubmit={async event => {
      event.preventDefault(); if (saving) return;
      setSaving(true); setError("");
      try { await onSave(draft); setEditing(false); }
      catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la nota."); }
      finally { setSaving(false); }
    }}>
      <textarea aria-label="Nota importante" value={draft} maxLength={300} rows={2}
        style={{ width: "100%", boxSizing: "border-box" }} disabled={saving}
        placeholder="Información que debe tener presente el cobrador…" onChange={event => setDraft(event.target.value)} />
      <div className="cxc-important-note-heading"><small>Se conserva entre jornadas. Para eliminarla, borra el texto y guarda.</small>
        <div><button type="button" className="button ghost small" disabled={saving} onClick={() => setEditing(false)}>Cancelar</button>{" "}
          <button className="button small" disabled={saving || disabled}>{saving ? "Guardando…" : "Guardar nota"}</button></div>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>}
  </aside>;
}
