import { useEffect, useState } from "react";
import { loadRouteVehicleDetails, type RouteVehicleDetails as VehicleDetails } from "../cloud/routeVehicleCloudData";

type Props = { ownerId: string; clientId: string; publishedAt: string; version: "legacy" | "v2" };

export default function RouteVehicleDetails({ ownerId, clientId, publishedAt, version }: Props) {
  const [details, setDetails] = useState<VehicleDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(false); setDetails(null);
    void loadRouteVehicleDetails({ ownerId, clientId, publishedAt, version }).then(value => {
      if (!disposed) setDetails(value);
    }).catch(() => {
      if (!disposed) setError(true);
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [ownerId, clientId, publishedAt, version, retry]);
  return <section className="route-vehicle-details" aria-label="Datos del auto">
    {loading ? <p role="status">Cargando datos del auto…</p> : error ? <div>
      <p role="alert">No se pudieron cargar los datos del auto.</p>
      <button type="button" className="button ghost small" onClick={() => setRetry(value => value + 1)}>Reintentar</button>
    </div> : <dl className="route-vehicle-details-fields">
      <div><dt>Placa</dt><dd>{details?.plate ?? "Sin registrar"}</dd></div>
      <div><dt>Color</dt><dd>{details?.color ?? "Sin registrar"}</dd></div>
      <div><dt>Marca / modelo</dt><dd>{details?.brandModel ?? "Sin registrar"}</dd></div>
    </dl>}
  </section>;
}
