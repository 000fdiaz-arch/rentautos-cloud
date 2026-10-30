import type { ControlUnitRow } from "../../cloudData";
import { FLEET_STATUS_OPTIONS, type UnitFormState } from "./controlUnitsRules";

type Props = {
  form: UnitFormState;
  editTarget: ControlUnitRow | null;
  groups: string[];
  onFormChange: (updater: (current: UnitFormState) => UnitFormState) => void;
  onUnitIdChange: (value: string) => void;
};

export function FleetVehicleFields({ form, editTarget, groups, onFormChange, onUnitIdChange }: Props) {
  const unitGroup = form.unit_id.slice(0, 1).toUpperCase();
  const unitNumber = form.unit_id.slice(1).replace(/\D/g, "");
  const availableGroups = unitGroup && !groups.includes(unitGroup) ? [unitGroup, ...groups] : groups;

  return (
    <div className="form-grid fleet-unified-vehicle-fields">
      <label>Letra / grupo del auto
        <select
          value={unitGroup}
          onChange={(event) => onUnitIdChange(`${event.target.value}${unitNumber}`)}
          disabled={Boolean(editTarget)}
        >
          <option value="">Selecciona una letra</option>
          {availableGroups.map((group) => <option key={group} value={group}>{group}</option>)}
        </select>
        <small className="hint">Las letras disponibles se configuran en Configuraciones → Reglas bancarias.</small>
      </label>
      <label>Número interno
        <input
          type="number"
          min="1"
          max="100"
          value={unitNumber}
          onChange={(event) => onUnitIdChange(`${unitGroup}${event.target.value}`)}
          placeholder="Ejemplo: 1"
          disabled={Boolean(editTarget) || !unitGroup}
        />
        <small className="hint">Código resultante: {form.unit_id || "—"}. No se muestra en el catálogo.</small>
        {editTarget && <small className="hint">Usa “Cambiar nomenclatura” en la vista Tabla para modificarlo.</small>}
      </label>
      <label>Marca / Modelo
        <input value={form.brand_model} onChange={(event) => onFormChange((s) => ({ ...s, brand_model: event.target.value }))} />
      </label>
      <label>Año
        <input value={form.year} onChange={(event) => onFormChange((s) => ({ ...s, year: event.target.value }))} />
      </label>
      <label>Empresa
        <input
          list="fleet-company-options"
          value={form.company}
          onChange={(event) => onFormChange((s) => ({ ...s, company: event.target.value }))}
          placeholder="Selecciona o escribe empresa"
        />
      </label>
      <label>Placa
        <input value={form.plate} onChange={(event) => onFormChange((s) => ({ ...s, plate: event.target.value }))} />
      </label>
      <label>Número de Panapass
        <input
          inputMode="numeric"
          value={form.panapass_number}
          onChange={(event) => onFormChange((s) => ({
            ...s,
            panapass_number: event.target.value.replace(/\D/g, "")
          }))}
          placeholder="Ejemplo: 0011335608"
        />
        <small className="hint">Se intenta leer del documento; si está escrito a mano, confírmalo o ingrésalo aquí.</small>
      </label>
      <label>Serial Motor
        <input value={form.engine_serial} onChange={(event) => onFormChange((s) => ({ ...s, engine_serial: event.target.value }))} />
      </label>
      <label>Serial Chasis
        <input value={form.chassis_serial} onChange={(event) => onFormChange((s) => ({ ...s, chassis_serial: event.target.value }))} />
      </label>
      <label>Color
        <input value={form.color} onChange={(event) => onFormChange((s) => ({ ...s, color: event.target.value }))} />
      </label>
      <label>Transmisión
        <select value={form.transmission} onChange={(event) => onFormChange((s) => ({ ...s, transmission: event.target.value }))}>
          <option value="">Selecciona</option>
          <option value="Automático">Automático</option>
          <option value="Manual">Manual</option>
        </select>
      </label>
      <label>Llave codificada
        <select value={form.key_coded} onChange={(event) => onFormChange((s) => ({ ...s, key_coded: event.target.value as UnitFormState["key_coded"] }))}>
          <option value="">Sin confirmar</option>
          <option value="yes">Sí, codificada</option>
          <option value="no">No codificada</option>
        </select>
        <small className="hint">Utiliza “Sin confirmar” si todavía no se ha probado la llave.</small>
      </label>
      <label>Estado operativo
        <select value={form.operational_status} onChange={(event) => onFormChange((s) => ({ ...s, operational_status: event.target.value }))}>
          {FLEET_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>
  );
}
