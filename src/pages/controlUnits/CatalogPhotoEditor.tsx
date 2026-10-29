import { memo } from "react";

type Props = {
  photoPreviewUrl: string;
  photoFile: File | null;
  onPhotoFileChange: (file: File | null) => void;
};

export const CatalogPhotoEditor = memo(function CatalogPhotoEditor({
  photoPreviewUrl,
  photoFile,
  onPhotoFileChange
}: Props) {
  return (
    <div className="fleet-catalog-photo-editor">
      {photoPreviewUrl ? (
        <img src={photoPreviewUrl} alt="Vista previa completa de la foto del auto" />
      ) : (
        <div className="fleet-catalog-photo-editor-empty">
          <span aria-hidden="true">📷</span>
          <strong>Aún no hay una foto</strong>
        </div>
      )}
      <div>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(event) => onPhotoFileChange(event.target.files?.[0] ?? null)}
        />
        <small className="hint">Puedes elegir una foto de la galería, usar la cámara o buscarla en tus archivos. Se guardará sin modificaciones; máximo 8 MB.</small>
        {photoFile && <small className="hint">Seleccionada: {photoFile.name}</small>}
      </div>
    </div>
  );
});
