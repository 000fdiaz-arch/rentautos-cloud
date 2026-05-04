import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

const AUTH_DOMAIN = "auth.rentautos.local";

function buildAuthEmailFromId(personId: string): string {
  const raw = personId.trim().toLowerCase();
  if (raw.includes("@")) return raw;
  const normalized = raw.replace(/[^a-z0-9._-]/g, "");
  return `${normalized}@${AUTH_DOMAIN}`;
}

export default function AuthPanel() {
  const [personId, setPersonId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!supabase) {
      setError("Falta configurar Supabase en variables de entorno.");
      return;
    }

    if (!personId.trim() || !password.trim()) {
      setError("Completa ID y password.");
      return;
    }

    const emailForAuth = buildAuthEmailFromId(personId);
    if (emailForAuth.startsWith(`@${AUTH_DOMAIN}`)) {
      setError("El ID no es valido.");
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: emailForAuth,
        password
      });
      if (signInError) throw signInError;
    } catch (err) {
      const nextError = err as { message?: string };
      setError(nextError.message ?? "No se pudo completar la accion.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Rentautos</h1>
        <p>Accede con tu ID y password.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            ID
            <input
              type="text"
              value={personId}
              onChange={(event) => setPersonId(event.target.value)}
              placeholder="Ejemplo: 8-123-456"
              autoComplete="username"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              autoComplete="current-password"
              required
            />
          </label>

          <button type="submit" className="button primary" disabled={loading}>
            {loading ? "Procesando..." : "Iniciar sesion"}
          </button>
        </form>

        {error && <div className="error-banner">{error}</div>}
      </section>
    </main>
  );
}
