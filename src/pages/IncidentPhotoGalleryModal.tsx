import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type IncidentGalleryPhoto = {
  name: string;
  path: string;
};

type Props<TPhoto extends IncidentGalleryPhoto> = {
  photos: TPhoto[];
  initialIndex: number;
  title: string;
  resolveUrl: (photo: TPhoto) => Promise<string>;
  onDelete?: (photo: TPhoto) => Promise<boolean>;
  onClose: () => void;
};

export default function IncidentPhotoGalleryModal<TPhoto extends IncidentGalleryPhoto>({ photos, initialIndex, title, resolveUrl, onDelete, onClose }: Props<TPhoto>) {
  const [galleryPhotos, setGalleryPhotos] = useState(photos);
  const [index, setIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(galleryPhotos.length - 1, 0)));
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [rotations, setRotations] = useState<Record<string, number>>({});
  const [zooms, setZooms] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const currentPhoto = galleryPhotos[index];
  const rotation = currentPhoto ? rotations[currentPhoto.path] ?? 0 : 0;
  const zoom = currentPhoto ? zooms[currentPhoto.path] ?? 1 : 1;

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
    const frame = window.requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentPhoto?.path, zoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === "ArrowLeft" && galleryPhotos.length > 1) {
        event.preventDefault();
        setIndex((current) => (current - 1 + galleryPhotos.length) % galleryPhotos.length);
      } else if (event.key === "ArrowRight" && galleryPhotos.length > 1) {
        event.preventDefault();
        setIndex((current) => (current + 1) % galleryPhotos.length);
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [galleryPhotos.length, onClose]);

  if (!currentPhoto) return null;

  const previous = (): void => setIndex((current) => (current - 1 + galleryPhotos.length) % galleryPhotos.length);
  const next = (): void => setIndex((current) => (current + 1) % galleryPhotos.length);
  const rotate = (degrees: number): void => {
    setRotations((current) => ({ ...current, [currentPhoto.path]: ((rotation + degrees) % 360 + 360) % 360 }));
  };
  const changeZoom = (nextZoom: number): void => {
    setZooms((current) => ({ ...current, [currentPhoto.path]: Math.min(3, Math.max(0.5, nextZoom)) }));
  };
  const startDragging = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (zoom <= 1 || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const stage = stageRef.current;
    if (!stage) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop };
    stage.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  };
  const dragImage = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = dragRef.current;
    const stage = stageRef.current;
    if (!start || !stage || start.pointerId !== event.pointerId) return;
    stage.scrollLeft = start.scrollLeft - (event.clientX - start.x);
    stage.scrollTop = start.scrollTop - (event.clientY - start.y);
    event.preventDefault();
  };
  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  };
  const deleteCurrentPhoto = async (): Promise<void> => {
    if (!onDelete || deleting || !window.confirm(`¿Eliminar ${currentPhoto.name}? Esta acción no se puede deshacer.`)) return;
    setDeleting(true);
    try {
      const deleted = await onDelete(currentPhoto);
      if (!deleted) return;
      const nextPhotos = galleryPhotos.filter((photo) => photo.path !== currentPhoto.path);
      if (!nextPhotos.length) { onClose(); return; }
      setGalleryPhotos(nextPhotos);
      setIndex((current) => Math.min(current, nextPhotos.length - 1));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="incident-photo-gallery-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="incident-photo-gallery" role="dialog" aria-modal="true" aria-label={title}>
        <header className="incident-photo-gallery-head">
          <div><strong>{title}</strong><span>{index + 1} de {galleryPhotos.length} · {currentPhoto.name}</span></div>
          <button type="button" className="button" onClick={onClose} autoFocus>Cerrar</button>
        </header>
        <div ref={stageRef} className={`incident-photo-gallery-stage${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`} onPointerDown={startDragging} onPointerMove={dragImage} onPointerUp={stopDragging} onPointerCancel={stopDragging}>
          {galleryPhotos.length > 1 && <button type="button" className="incident-photo-gallery-arrow previous" aria-label="Foto anterior" onClick={previous}>‹</button>}
          {loading && <p className="hint">Cargando foto...</p>}
          {error && <p className="workflow-message" role="alert">{error}</p>}
          {!loading && !error && imageUrl && <div className="incident-photo-gallery-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}><img className={rotation % 180 === 0 ? "" : "is-rotated-sideways"} style={{ transform: `rotate(${rotation}deg)` }} src={imageUrl} alt={`${title}: ${currentPhoto.name}`} /></div>}
          {galleryPhotos.length > 1 && <button type="button" className="incident-photo-gallery-arrow next" aria-label="Foto siguiente" onClick={next}>›</button>}
        </div>
        <footer className="incident-photo-gallery-controls">
          <div className="incident-photo-gallery-zoom" aria-label="Zoom de imagen"><button type="button" onClick={() => changeZoom(zoom - 0.25)} disabled={zoom <= 0.5} aria-label="Alejar imagen">−</button><button type="button" className="incident-photo-gallery-zoom-value" onClick={() => changeZoom(1)} aria-label="Restablecer zoom al 100%">{Math.round(zoom * 100)}%</button><button type="button" onClick={() => changeZoom(zoom + 0.25)} disabled={zoom >= 3} aria-label="Acercar imagen">+</button></div>
          <div className="incident-photo-gallery-rotation" aria-label="Rotar imagen"><button type="button" onClick={() => rotate(-90)} aria-label="Rotar 90 grados a la izquierda">↶ <span>Izquierda</span></button><small>{rotation}°</small><button type="button" onClick={() => rotate(90)} aria-label="Rotar 90 grados a la derecha">↷ <span>Derecha</span></button></div>
          {onDelete && <button type="button" className="incident-photo-gallery-delete" onClick={() => void deleteCurrentPhoto()} disabled={deleting}>{deleting ? "Eliminando..." : "Eliminar foto"}</button>}
          {galleryPhotos.length > 1 && <nav className="incident-photo-gallery-index" aria-label="Seleccionar foto">{galleryPhotos.map((photo, photoIndex) => <button key={photo.path} type="button" className={photoIndex === index ? "active" : ""} aria-label={`Ver foto ${photoIndex + 1}: ${photo.name}`} aria-current={photoIndex === index ? "true" : undefined} onClick={() => setIndex(photoIndex)}>{photoIndex + 1}</button>)}</nav>}
        </footer>
      </section>
    </div>
  );
}
