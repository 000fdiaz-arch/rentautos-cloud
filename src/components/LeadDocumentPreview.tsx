import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent } from "react";

type Props = { src: string; name: string };
const MAX_ZOOM = 4;

function DocumentViewer({ src, name, onClose }: Props & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const center = useRef({ x: 0.5, y: 0.5 });
  const fit = natural.width && viewport.width
    ? Math.min(1, viewport.width / natural.width, viewport.height / natural.height) : 0;
  const width = natural.width * fit * zoom;
  const height = natural.height * fit * zoom;
  const canvasWidth = Math.max(viewport.width, width);
  const canvasHeight = Math.max(viewport.height, height);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    const viewportElement = viewportRef.current;
    const observer = new ResizeObserver(() => {
      if (viewportElement) setViewport({ width: viewportElement.clientWidth, height: viewportElement.clientHeight });
    });
    if (viewportElement) observer.observe(viewportElement);
    return () => {
      observer.disconnect();
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    element.scrollLeft = (canvasWidth - width) / 2 + center.current.x * width - viewport.width / 2;
    element.scrollTop = (canvasHeight - height) / 2 + center.current.y * height - viewport.height / 2;
  }, [width, height, canvasWidth, canvasHeight, viewport.width, viewport.height]);

  function changeZoom(next: number): void {
    const element = viewportRef.current;
    if (element && width && height) {
      center.current = next === 1 ? { x: 0.5, y: 0.5 } : {
        x: (element.scrollLeft + viewport.width / 2 - (canvasWidth - width) / 2) / width,
        y: (element.scrollTop + viewport.height / 2 - (canvasHeight - height) / 2) / height
      };
    }
    setZoom(Math.min(MAX_ZOOM, Math.max(1, next)));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>): void {
    if (zoom === 1 || event.button !== 0 || !event.isPrimary) return;
    const element = event.currentTarget;
    drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  }

  return createPortal(
    <dialog ref={dialogRef} className="lead-document-dialog" aria-labelledby="lead-document-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <div className="lead-document-dialog-head">
        <div><h2 id="lead-document-title">Verificar documento</h2><p>{name}</p></div>
        <button type="button" className="button ghost small" autoFocus onClick={onClose}>Cerrar</button>
      </div>
      <div className="lead-document-toolbar" role="group" aria-label="Controles de zoom">
        <button type="button" className="button ghost small" aria-label="Reducir imagen" disabled={zoom <= 1 || failed || !fit} onClick={() => changeZoom(zoom - 0.25)}>−</button>
        <output aria-label="Nivel de zoom" aria-live="polite">{Math.round(zoom * 100)}%</output>
        <button type="button" className="button ghost small" aria-label="Ampliar imagen" disabled={zoom >= MAX_ZOOM || failed || !fit} onClick={() => changeZoom(zoom + 0.25)}>+</button>
        <button type="button" className="button ghost small" disabled={failed || !fit} onClick={() => changeZoom(1)}>Ajustar a pantalla</button>
      </div>
      <p className="lead-document-help">Amplía con + y −. Arrastra o desplázate para revisar los detalles. Esc para cerrar.</p>
      <div ref={viewportRef} className={`lead-document-viewport ${zoom > 1 ? "is-zoomed" : ""}`} tabIndex={0} aria-label="Imagen del documento ampliada"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {failed ? <p role="alert" className="lead-document-image-error">No se pudo cargar la imagen. Solicita al vendedor que envíe un documento legible nuevamente.</p> : (
          <div className="lead-document-canvas" style={{ width: canvasWidth, height: canvasHeight }}>
            <img src={src} alt={`Documento para verificar: ${name}`} draggable={false}
              onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
              style={{ width, height, left: (canvasWidth - width) / 2, top: (canvasHeight - height) / 2 }} />
          </div>
        )}
      </div>
    </dialog>, document.body
  );
}

export default function LeadDocumentPreview({ src, name }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lead-document-open" aria-label="Ampliar documento adjunto" onClick={() => setOpen(true)}>
        <img className="lead-document-preview" src={src} alt={`Documento adjunto ${name}`} />
        <span className="lead-result-actions">Ampliar documento</span>
      </button>
      {open && <DocumentViewer src={src} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
