import { useState, type FormEvent } from "react";
import { markOwnPasswordChanged } from "../cloudData";
import { supabase } from "../lib/supabase";

type Props = {
  onChanged: () => void;
};

export default function ForcePasswordChangePanel({ onChanged }: Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");

    if (!supabase) {
      setError("Falta configurar Supabase.");
      return;
    }
    if (password.length < 8) {
      setError("La nueva contrasena debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contrasenas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await markOwnPasswordChanged();
      await supabase.auth.refreshSession();
      onChanged();
    } catch (changeError) {
      console.error("No se pudo cambiar la contrasena.", changeError);
      setError("No se pudo cambiar la contrasena. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Rentautos</h1>
        <p>Debes cambiar tu contrasena antes de continuar.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Nueva contrasena
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Confirmar contrasena
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <button type="submit" className="button primary" disabled={loading}>
            {loading ? "Guardando..." : "Cambiar contrasena"}
          </button>
        </form>

        {error && <div className="error-banner">{error}</div>}
      </section>
    </main>
  );
}
