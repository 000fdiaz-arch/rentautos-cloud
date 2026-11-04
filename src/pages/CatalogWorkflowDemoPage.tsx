import { useEffect, useState } from "react";
import type { ControlUnitRow } from "../cloudData";
import { FleetCatalog } from "./controlUnits/FleetCatalog";
import { UnitFormModal } from "./controlUnits/UnitFormModal";
import { toFormState, type UnitFormState } from "./controlUnits/controlUnitsRules";

const SAMPLE_ROW: ControlUnitRow = {
  fleet_id: "demo-kia-picanto",
  user_id: "demo-owner",
  unit_id: "A01",
  company: "Rentautos",
  brand_model: "KIA PICANTO",
  engine_serial: "",
  chassis_serial: "",
  plate: "",
  cupo: null,
  observation: null,
  is_exception: false,
  exception_note: null,
  client_id: null,
  client_name: null,
  client_cedula: null,
  operational_status: "libre",
  financial_balance: 0,
  financial_status: "sin_cliente",
  last_payment_date: null,
  model_year: 2024,
  color: "PLATEADO",
  transmission_type: "Automático",
  key_coded: true,
  mileage: 0,
  catalog_contract_months: 36,
  catalog_daily_rate: 34,
  catalog_weekly_rate: 198,
  catalog_biweekly_rate: 390,
  catalog_daily_management_fee: 100,
  catalog_weekly_management_fee: 100,
  catalog_biweekly_management_fee: 100,
  catalog_photo_path: "demo/kia-picanto-original.png",
  catalog_photo_url: "/catalog-demo/kia-picanto-original.png"
};

function optionalDemoNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function CatalogWorkflowDemoPage() {
  const [row, setRow] = useState<ControlUnitRow>(SAMPLE_ROW);
  const [form, setForm] = useState<UnitFormState>(() => toFormState(SAMPLE_ROW));
  const [editing, setEditing] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [temporaryPhotoUrl, setTemporaryPhotoUrl] = useState("");

  useEffect(() => () => {
    if (temporaryPhotoUrl) URL.revokeObjectURL(temporaryPhotoUrl);
  }, [temporaryPhotoUrl]);

  function openEditor(): void {
    setForm(toFormState(row));
    setPhotoFile(null);
    setSavedMessage("");
    setEditing(true);
  }

  function saveDemo(): void {
    let nextPhotoUrl = row.catalog_photo_url;
    if (photoFile) {
      if (temporaryPhotoUrl) URL.revokeObjectURL(temporaryPhotoUrl);
      nextPhotoUrl = URL.createObjectURL(photoFile);
      setTemporaryPhotoUrl(nextPhotoUrl);
    }
    setRow((current) => ({
      ...current,
      brand_model: form.brand_model || current.brand_model,
      model_year: optionalDemoNumber(form.year),
      transmission_type: form.transmission || current.transmission_type,
      catalog_contract_months: optionalDemoNumber(form.catalog_contract_months),
      catalog_daily_rate: optionalDemoNumber(form.catalog_daily_rate),
      catalog_weekly_rate: optionalDemoNumber(form.catalog_weekly_rate),
      catalog_biweekly_rate: optionalDemoNumber(form.catalog_biweekly_rate),
      catalog_daily_management_fee: optionalDemoNumber(form.catalog_daily_management_fee),
      catalog_weekly_management_fee: optionalDemoNumber(form.catalog_weekly_management_fee),
      catalog_biweekly_management_fee: optionalDemoNumber(form.catalog_biweekly_management_fee),
      catalog_photo_url: nextPhotoUrl
    }));
    setEditing(false);
    setSavedMessage("Vista de demostración actualizada. No se guardaron datos en Supabase.");
  }

  return (
    <main className="catalog-workflow-demo-page">
      <header className="catalog-workflow-demo-head">
        <div><span>Demostración local</span><h1>Flujo del catálogo de autos</h1><p>Prueba duración, gestión por plan y carga de foto sin modificar datos reales.</p></div>
        <a className="button ghost" href="/">Volver al inicio</a>
      </header>

      <section className="catalog-workflow-demo-guide">
        <div><strong>1</strong><span>Presiona “Editar”.</span></div>
        <div><strong>2</strong><span>Abre “Ficha del catálogo”.</span></div>
        <div><strong>3</strong><span>Cambia meses, alquiler o gestión.</span></div>
        <div><strong>4</strong><span>Selecciona una foto y guarda.</span></div>
      </section>

      {savedMessage && <p className="catalog-workflow-demo-message" role="status">✓ {savedMessage}</p>}
      <FleetCatalog rows={[row]} readOnly={false} onEdit={openEditor} />

      {editing && (
        <UnitFormModal
          form={form}
          editTarget={row}
          catalogOnly
          companies={["Rentautos"]}
          groups={["A", "B", "C"]}
          saving={false}
          photoFile={photoFile}
          existingRows={[row]}
          onFormChange={setForm}
          onUnitIdChange={(value) => setForm((current) => ({ ...current, unit_id: value }))}
          onPhotoFileChange={setPhotoFile}
          onCancel={() => setEditing(false)}
          onSave={saveDemo}
        />
      )}
    </main>
  );
}
