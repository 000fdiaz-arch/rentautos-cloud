import { useEffect, useMemo, useState } from "react";
import {
  APP_SCREENS,
  getRoleScreenPermissions,
  normalizeAppPermissions,
  type AppPermissions,
  type AppRole,
  type AppScreen
} from "../../auth/permissions";
import {
  buildRolePermissions,
  createAppUser,
  loadUserProfiles,
  resetAppUserPassword,
  saveUserProfileAccess,
  type UserProfileRow
} from "../../cloudData";

type Props = {
  currentUserId?: string;
};

const ROLE_OPTIONS: Array<{ value: AppRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "operador", label: "Operador" },
  { value: "buscador", label: "Buscador" },
  { value: "lectura", label: "Lectura" }
];

function clonePermissions(permissions: AppPermissions): AppPermissions {
  return APP_SCREENS.reduce((acc, screen) => {
    acc[screen.id] = { ...permissions[screen.id] };
    return acc;
  }, {} as AppPermissions);
}

function roleLabel(role: AppRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function defaultOwnerId(role: AppRole, profileId: string, fallbackOwnerId?: string): string {
  return role === "admin" ? profileId : fallbackOwnerId || profileId;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "";
}

export default function UserPermissionsSettingsPanel({ currentUserId }: Props) {
  const [profiles, setProfiles] = useState<UserProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState<AppRole>("lectura");
  const [draftOwnerId, setDraftOwnerId] = useState("");
  const [draftPermissions, setDraftPermissions] = useState<AppPermissions>(() => getRoleScreenPermissions("lectura"));
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLogin, setCreateLogin] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<AppRole>("lectura");
  const [createOwnerId, setCreateOwnerId] = useState("");
  const [createPermissions, setCreatePermissions] = useState<AppPermissions>(() => getRoleScreenPermissions("lectura"));
  const [resetTarget, setResetTarget] = useState<UserProfileRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
    [profiles]
  );
  const ownerOptions = useMemo(
    () => sortedProfiles.filter((profile) => profile.role === "admin"),
    [sortedProfiles]
  );
  const fallbackOwnerId = useMemo(
    () => ownerOptions.find((profile) => profile.id === currentUserId)?.id ?? ownerOptions[0]?.id ?? currentUserId ?? "",
    [currentUserId, ownerOptions]
  );
  const editingProfile = useMemo(
    () => sortedProfiles.find((profile) => profile.id === editingId) ?? null,
    [editingId, sortedProfiles]
  );

  async function reload(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const rows = await loadUserProfiles();
      setProfiles(rows);
    } catch (loadError) {
      console.error("No se pudieron cargar usuarios.", loadError);
      setError("No se pudieron cargar los usuarios. Verifica que tu usuario tenga permiso de admin.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function startEdit(profile: UserProfileRow): void {
    setEditingId(profile.id);
    setDraftRole(profile.role);
    setDraftOwnerId(profile.data_owner_user_id ?? profile.id);
    setDraftPermissions(clonePermissions(normalizeAppPermissions(profile.role, profile.permissions)));
    setMessage("");
    setError("");
  }

  function openCreate(): void {
    const role: AppRole = "lectura";
    setCreateLogin("");
    setCreatePassword("");
    setCreateRole(role);
    setCreateOwnerId(fallbackOwnerId);
    setCreatePermissions(buildRolePermissions(role));
    setCreateOpen(true);
    setMessage("");
    setError("");
  }

  function applyRolePreset(role: AppRole): void {
    setDraftRole(role);
    setDraftPermissions(buildRolePermissions(role));
    if (role === "admin" && editingProfile) setDraftOwnerId(editingProfile.id);
  }

  function applyCreateRolePreset(role: AppRole): void {
    setCreateRole(role);
    setCreatePermissions(buildRolePermissions(role));
    setCreateOwnerId(role === "admin" ? "" : fallbackOwnerId);
  }

  function togglePermission(screen: AppScreen, field: "view" | "edit", checked: boolean): void {
    setDraftPermissions((current) => {
      const next = clonePermissions(current);
      if (field === "view") {
        next[screen] = { view: checked, edit: checked ? next[screen].edit : false };
      } else {
        next[screen] = { view: checked ? true : next[screen].view, edit: checked };
      }
      return next;
    });
  }

  function toggleCreatePermission(screen: AppScreen, field: "view" | "edit", checked: boolean): void {
    setCreatePermissions((current) => {
      const next = clonePermissions(current);
      if (field === "view") {
        next[screen] = { view: checked, edit: checked ? next[screen].edit : false };
      } else {
        next[screen] = { view: checked ? true : next[screen].view, edit: checked };
      }
      return next;
    });
  }

  async function save(): Promise<void> {
    if (!editingProfile) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await saveUserProfileAccess({
        id: editingProfile.id,
        role: draftRole,
        dataOwnerUserId: defaultOwnerId(draftRole, editingProfile.id, draftOwnerId),
        permissions: draftPermissions
      });
      setMessage("Permisos actualizados.");
      setEditingId(null);
      await reload();
    } catch (saveError) {
      console.error("No se pudieron guardar permisos.", saveError);
      setError("No se pudieron guardar los permisos. Revisa RLS/perfil y vuelve a intentar.");
    } finally {
      setSaving(false);
    }
  }

  async function createUser(): Promise<void> {
    const login = createLogin.trim();
    if (!login) {
      setError("Falta el usuario o email.");
      return;
    }
    if (createPassword.length < 8) {
      setError(`La contrasena temporal debe tener al menos 8 caracteres. Actualmente tiene ${createPassword.length}.`);
      return;
    }
    if (createRole !== "admin" && !createOwnerId && !fallbackOwnerId) {
      setError("Falta seleccionar el dataset/owner para este usuario.");
      return;
    }

    setCreating(true);
    setMessage("");
    setError("");
    try {
      await createAppUser({
        login,
        password: createPassword,
        role: createRole,
        dataOwnerUserId: createRole === "admin" ? null : createOwnerId || fallbackOwnerId || null,
        permissions: createPermissions
      });
      setCreateOpen(false);
      setMessage("Usuario creado. Debera cambiar la contrasena en su primer inicio.");
      await reload();
    } catch (createError) {
      console.error("No se pudo crear usuario.", createError);
      const details = getErrorMessage(createError);
      setError(
        details
          ? `No se pudo crear el usuario: ${details}`
          : "No se pudo crear el usuario. Verifica que no exista y que la migracion 21 este aplicada."
      );
    } finally {
      setCreating(false);
    }
  }

  async function resetPasswordForUser(): Promise<void> {
    if (!resetTarget) return;
    if (resetPassword.length < 8) {
      setError("La contrasena temporal debe tener al menos 8 caracteres.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");
    try {
      await resetAppUserPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword("");
      setMessage("Contrasena temporal actualizada. El usuario debera cambiarla al iniciar sesion.");
    } catch (resetError) {
      console.error("No se pudo resetear contrasena.", resetError);
      setError("No se pudo resetear la contrasena. Verifica permisos admin y migracion 21.");
    } finally {
      setSaving(false);
    }
  }

  function renderPermissionRows(
    permissions: AppPermissions,
    onToggle: (screen: AppScreen, field: "view" | "edit", checked: boolean) => void
  ) {
    return APP_SCREENS.map((screen) => (
      <tr key={screen.id}>
        <td><strong>{screen.label}</strong></td>
        <td>
          <input
            type="checkbox"
            checked={permissions[screen.id].view}
            onChange={(event) => onToggle(screen.id, "view", event.target.checked)}
          />
        </td>
        <td>
          <input
            type="checkbox"
            checked={permissions[screen.id].edit}
            onChange={(event) => onToggle(screen.id, "edit", event.target.checked)}
          />
        </td>
      </tr>
    ));
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Usuarios</h2>
          <p className="hint">Crea usuarios, asigna pantallas visibles y permisos de edicion.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="button ghost" onClick={() => void reload()} disabled={loading || saving || creating}>
            Actualizar
          </button>
          <button type="button" className="button primary" onClick={openCreate} disabled={loading || saving || creating}>
            Agregar usuario
          </button>
        </div>
      </div>

      {message && <p className="success-text">{message}</p>}
      {error && !createOpen && <p className="error-text">{error}</p>}

      {loading ? (
        <p className="hint">Cargando usuarios...</p>
      ) : (
        <div className="table-scroll">
          <table className="ar-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Dataset</th>
                <th>Pantallas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sortedProfiles.map((profile) => {
                const visibleScreens = APP_SCREENS
                  .filter((screen) => profile.permissions[screen.id].view)
                  .map((screen) => `${screen.label}${profile.permissions[screen.id].edit ? " (editar)" : " (leer)"}`);
                const owner = sortedProfiles.find((item) => item.id === (profile.data_owner_user_id ?? profile.id));
                return (
                  <tr key={profile.id}>
                    <td>
                      <strong>{profile.email ?? profile.id}</strong>
                      {profile.id === currentUserId && <div className="hint">Sesion actual</div>}
                    </td>
                    <td>{roleLabel(profile.role)}</td>
                    <td>{owner?.email ?? profile.data_owner_user_id ?? "Propio"}</td>
                    <td>{visibleScreens.length > 0 ? visibleScreens.join(", ") : "Sin pantallas"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="button ghost small" onClick={() => startEdit(profile)}>
                          Editar permisos
                        </button>
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => {
                            setResetTarget(profile);
                            setResetPassword("");
                            setMessage("");
                            setError("");
                          }}
                        >
                          Reset password
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 920 }}>
            <div className="modal-header">
              <h2>Agregar usuario</h2>
              <button type="button" className="modal-close" onClick={() => setCreateOpen(false)}>
                X
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <label>Usuario o email
                  <input
                    value={createLogin}
                    onChange={(event) => setCreateLogin(event.target.value)}
                    placeholder="usuario o usuario@correo.com"
                  />
                </label>
                <label>Contrasena temporal
                  <input
                    type="password"
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label>Rol base
                  <select value={createRole} onChange={(event) => applyCreateRolePreset(event.target.value as AppRole)}>
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>Dataset/owner
                  <select
                    value={createOwnerId}
                    onChange={(event) => setCreateOwnerId(event.target.value)}
                    disabled={createRole === "admin"}
                  >
                    {ownerOptions.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.email ?? profile.id}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="table-scroll" style={{ marginTop: 14 }}>
                <table className="ar-table">
                  <thead>
                    <tr>
                      <th>Pantalla</th>
                      <th>Ver</th>
                      <th>Editar</th>
                    </tr>
                  </thead>
                  <tbody>{renderPermissionRows(createPermissions, toggleCreatePermission)}</tbody>
                </table>
              </div>

              <p className="hint" style={{ marginTop: 12 }}>
                La contrasena temporal se marca como obligatoria de cambiar en el primer inicio de sesion.
              </p>
              {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="button ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                  Cancelar
                </button>
                <button type="button" className="button primary" onClick={() => void createUser()} disabled={creating}>
                  {creating ? "Creando..." : "Crear usuario"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingProfile && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 920 }}>
            <div className="modal-header">
              <h2>{editingProfile.email ?? "Usuario"}</h2>
              <button type="button" className="modal-close" onClick={() => setEditingId(null)}>
                X
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <label>Rol base
                  <select value={draftRole} onChange={(event) => applyRolePreset(event.target.value as AppRole)}>
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>Dataset/owner
                  <select value={draftOwnerId} onChange={(event) => setDraftOwnerId(event.target.value)}>
                    <option value={editingProfile.id}>Propio</option>
                    {ownerOptions.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.email ?? profile.id}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="table-scroll" style={{ marginTop: 14 }}>
                <table className="ar-table">
                  <thead>
                    <tr>
                      <th>Pantalla</th>
                      <th>Ver</th>
                      <th>Editar</th>
                    </tr>
                  </thead>
                  <tbody>{renderPermissionRows(draftPermissions, togglePermission)}</tbody>
                </table>
              </div>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="button ghost" onClick={() => setEditingId(null)} disabled={saving}>
                  Cancelar
                </button>
                <button type="button" className="button primary" onClick={() => void save()} disabled={saving}>
                  {saving ? "Guardando..." : "Guardar permisos"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Reset password</h2>
              <button type="button" className="modal-close" onClick={() => setResetTarget(null)}>
                X
              </button>
            </div>
            <div className="modal-body">
              <p className="hint">{resetTarget.email ?? resetTarget.id}</p>
              <label>Contrasena temporal
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <p className="hint" style={{ marginTop: 12 }}>
                Al entrar con esta contrasena, el usuario tendra que cambiarla antes de usar la app.
              </p>
              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="button ghost" onClick={() => setResetTarget(null)} disabled={saving}>
                  Cancelar
                </button>
                <button type="button" className="button primary" onClick={() => void resetPasswordForUser()} disabled={saving}>
                  {saving ? "Guardando..." : "Guardar reset"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
