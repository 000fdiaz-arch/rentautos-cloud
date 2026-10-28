import { useEffect, useMemo, useState } from "react";
import { loadPublicFleetCatalog, type ControlUnitRow } from "../cloudData";
import { FleetCatalog } from "./controlUnits/FleetCatalog";

type Props = {
  ownerUserId: string;
};

export default function PublicFleetCatalogPage({ ownerUserId }: Props) {
  const [rows, setRows] = useState<ControlUnitRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Catálogo de autos";
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadPublicFleetCatalog(ownerUserId)
      .then((items) => {
        if (!cancelled) setRows(items);
      })
      .catch((loadError) => {
        console.error("No se pudo cargar el catalogo publico.", loadError);
        if (!cancelled) setError("No se pudo cargar el catálogo en este momento.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerUserId]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    if (!query) return rows;
    return rows.filter((row) => [row.brand_model, row.model_year, row.transmission_type]
      .some((value) => String(value ?? "").toLocaleLowerCase("es").includes(query)));
  }, [rows, search]);

  return (
    <main className="public-fleet-catalog-page">
      <header className="public-fleet-catalog-header">
        <div>
          <span>Autos disponibles</span>
          <h1>Catálogo</h1>
          <p>Consulta los vehículos y planes disponibles.</p>
        </div>
        <label>Buscar
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Modelo, año o transmisión" />
        </label>
      </header>

      {loading ? <p className="public-fleet-catalog-message">Cargando catálogo...</p> : null}
      {error ? <p className="public-fleet-catalog-message error-text" role="alert">{error}</p> : null}
      {!loading && !error ? (
        <FleetCatalog rows={visibleRows} readOnly onEdit={() => undefined} />
      ) : null}
      <footer className="public-fleet-catalog-footer">Disponibilidad sujeta a confirmación.</footer>
    </main>
  );
}
