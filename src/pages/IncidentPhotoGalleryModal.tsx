import { useEffect, useState } from "react";

export type IncidentGalleryPhoto = {
  name: string;
  path: string;
};

type Props<TPhoto extends IncidentGalleryPhoto> = {
  photos: TPhoto[];
  initialIndex: number;
  title: string;
  resolveUrl: (photo: TPhoto) => Promise<string>;
  onClose: () => void;
};

export default function IncidentPhotoGalleryModal<TPhoto extends IncidentGalleryPhoto>({ photos, initialIndex, title, resolveUrl, onClose }: Props<TPhoto>) {
  const [index, setIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(photos.length - 1, 0)));
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const currentPhoto = photos[index];

  useEffect(() => {
    if (!currentPhoto) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setImageUrl("");
    resolveUrl(currentPhoto)
      .then((url) => { if (!cancelled) setImageUrl(url); })
      .catch((loadError) => {
        console.error("No se pudo cargar la foto en la galería.", loadError);
        if (!cancelled) setError("No se pudo cargar esta foto.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentPhoto, resolveUrl]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === "ArrowLeft" && photos.length > 1) {
        event.preventDefault();
        setIndex((current) => (current - 1 + photos.length) % photos.length);
      } else if (event.key === "ArrowRight" && photos.length > 1) {
        event.preventDefault();
        setIndex((current) => (current + 1) % photos.length);
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, photos.length]);

  if (!currentPhoto) return null;

  const previous = (): void => setIndex((current) => (current - 1 + photos.length) % photos.length);
  const next = (): void => setIndex((current) => (current + 1) % photos.length);

  return (
    <div className="incident-photo-gallery-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="incident-photo-gallery" role="dialog" aria-modal="true" aria-label={title}>
        <header className="incident-photo-gallery-head">
          <div><strong>{title}</strong><span>{index + 1} de {photos.length} · {currentPhoto.name}</span></div>
          <button type="button" className="button" onClick={onClose} autoFocus>Cerrar</button>
        </header>
        <div className="incident-photo-gallery-stage">
          {photos.length > 1 && <button type="button" className="incident-photo-gallery-arrow previous" aria-label="Foto anterior" onClick={previous}>‹</button>}
          {loading && <p className="hint">Cargando foto...</p>}
          {error && <p className="workflow-message" role="alert">{error}</p>}
          {!loading && !error && imageUrl && <img src={imageUrl} alt={`${title}: ${currentPhoto.name}`} />}
          {photos.length > 1 && <button type="button" className="incident-photo-gallery-arrow next" aria-label="Foto siguiente" onClick={next}>›</button>}
        </div>
        {photos.length > 1 && <nav className="incident-photo-gallery-index" aria-label="Seleccionar foto">{photos.map((photo, photoIndex) => <button key={photo.path} type="button" className={photoIndex === index ? "active" : ""} aria-label={`Ver foto ${photoIndex + 1}: ${photo.name}`} aria-current={photoIndex === index ? "true" : undefined} onClick={() => setIndex(photoIndex)}>{photoIndex + 1}</button>)}</nav>}
      </section>
    </div>
  );
}
