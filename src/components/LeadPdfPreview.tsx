import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = { src: string; name: string };

function PdfViewer({ src, name, onClose }: Props & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();

    let active = true;
    let objectUrl = "";
    void fetch(src)
      .then((response) => response.blob())
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [src]);

  return createPortal(
    <dialog ref={dialogRef} className="lead-document-dialog" aria-labelledby="lead-pdf-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <div className="lead-document-dialog-head">
        <div><h2 id="lead-pdf-title">Verificar documento PDF</h2><p>{name}</p></div>
        <button type="button" className="button ghost small" autoFocus onClick={onClose}>Cerrar</button>
      </div>
      <div className="lead-pdf-actions">
        <a className="button ghost small" href={pdfUrl || undefined} target="_blank" rel="noreferrer"
          aria-disabled={!pdfUrl} onClick={(event) => { if (!pdfUrl) event.preventDefault(); }}>Abrir en otra pestaña</a>
        <a className="button ghost small" href={pdfUrl || undefined} download={name}
          aria-disabled={!pdfUrl} onClick={(event) => { if (!pdfUrl) event.preventDefault(); }}>Descargar PDF</a>
      </div>
      {failed ? (
        <p role="alert" className="lead-pdf-error">No se pudo preparar el PDF para mostrarlo. Intenta cargar el documento nuevamente.</p>
      ) : pdfUrl ? (
        <iframe className="lead-pdf-frame" src={pdfUrl} title={`Documento PDF para verificar: ${name}`} />
      ) : (
        <p role="status" className="lead-pdf-loading">Preparando PDF...</p>
      )}
    </dialog>, document.body
  );
}

export default function LeadPdfPreview({ src, name }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lead-pdf-open" aria-label="Ver PDF adjunto" onClick={() => setOpen(true)}>
        <span className="lead-pdf-icon" aria-hidden="true">PDF</span>
        <span className="lead-pdf-summary"><strong>{name}</strong><span>Ver PDF</span></span>
      </button>
      {open && <PdfViewer src={src} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
