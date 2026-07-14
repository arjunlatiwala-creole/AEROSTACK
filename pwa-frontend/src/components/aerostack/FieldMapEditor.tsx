/**
 * Field Map Editor
 *
 * Drag-and-drop overlay on top of a PDF preview. Lets the sender place
 * field markers (signature, name, date, intake form values) at exact
 * positions on the document.
 *
 * Coordinate system:
 *   - The overlay renders the PDF using <react-pdf>
 *   - Each rendered page exposes its actual pixel size + the underlying
 *     PDF point size (1 point = 1/72 inch)
 *   - We store coordinates in PDF native units so the backend's pdf-lib
 *     can place content without re-mapping
 *   - PDF y-axis is bottom-up (0 = bottom). We convert from screen y
 *     (top-down) to PDF y when emitting markers.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Trash2, MousePointer2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { FieldMarker, IntakeFormField, DocuSignSigner } from "@/api/document-host";

// Configure pdfjs worker — bundled by Vite via ?url
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

// ─── Field palette ─────────────────────────────────────────────────────────

interface PaletteField {
  id: string;
  label: string;
  bg: string;
  defaultWidth: number;
  defaultHeight: number;
  custom?: boolean;
}

interface FieldMapEditorProps {
  /** PDF download URL (typically a presigned S3 URL). */
  pdfUrl: string;
  /** Existing markers — passed back unchanged when editor opens fresh. */
  initialMarkers?: FieldMarker[];
  /** Available signers (so each marker can be assigned to one). */
  signers: DocuSignSigner[];
  /** Sender-defined intake form fields (selectable as marker types). */
  intakeFields: IntakeFormField[];
  onChange: (markers: FieldMarker[]) => void;
}

export function FieldMapEditor({
  pdfUrl,
  initialMarkers = [],
  signers,
  intakeFields,
  onChange,
}: FieldMapEditorProps) {
  const [markers, setMarkers] = useState<FieldMarker[]>(initialMarkers);
  const [pageCount, setPageCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [selectedField, setSelectedField] = useState<PaletteField | null>(null);
  const [activeRecipient, setActiveRecipient] = useState<string>("1");
  const [pageDims, setPageDims] = useState<{ pdfWidth: number; pdfHeight: number; renderWidth: number; renderHeight: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const pageContainerRef = useRef<HTMLDivElement>(null);

  // Built-in fields + dynamic palette from intake form
  const palette = useMemo<PaletteField[]>(() => {
    const builtins: PaletteField[] = [
      { id: "__signature__", label: "✍️ Signature", bg: "bg-emerald-100 border-emerald-400 text-emerald-800", defaultWidth: 150, defaultHeight: 50 },
      { id: "__name__", label: "Full name", bg: "bg-blue-100 border-blue-400 text-blue-800", defaultWidth: 180, defaultHeight: 20 },
      { id: "__date__", label: "Date", bg: "bg-purple-100 border-purple-400 text-purple-800", defaultWidth: 100, defaultHeight: 20 },
    ];
    const formFields: PaletteField[] = intakeFields.map((f) => ({
      id: f.id,
      label: f.label,
      bg: "bg-amber-100 border-amber-400 text-amber-800",
      defaultWidth: 180,
      defaultHeight: f.type === "textarea" ? 60 : 20,
      custom: true,
    }));
    return [...builtins, ...formFields];
  }, [intakeFields]);

  useEffect(() => {
    onChange(markers);
  }, [markers, onChange]);

  const pageMarkers = markers.filter((m) => m.page === activePage);

  function handlePageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!selectedField || !pageDims || !pageContainerRef.current) return;
    const rect = pageContainerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert screen pixels → PDF points
    const scale = pageDims.pdfWidth / pageDims.renderWidth;
    const pdfX = screenX * scale;
    // PDF y is bottom-up; flip from top-down screen y
    const pdfY = pageDims.pdfHeight - (screenY * scale) - selectedField.defaultHeight;

    const newMarker: FieldMarker = {
      field_id: selectedField.id,
      page: activePage,
      x: Math.max(0, Math.round(pdfX)),
      y: Math.max(0, Math.round(pdfY)),
      width: selectedField.defaultWidth,
      height: selectedField.defaultHeight,
      // Built-in fields (signature/name/date) are always per-signer.
      // Intake form fields default to "shared" but can be per-signer if the
      // field itself is tagged with a recipient_id.
      ...(selectedField.id === "__signature__" ||
        selectedField.id === "__name__" ||
        selectedField.id === "__date__"
        ? { recipient_id: activeRecipient }
        : intakeFields.find((f) => f.id === selectedField.id)?.recipient_id
        ? { recipient_id: intakeFields.find((f) => f.id === selectedField.id)!.recipient_id }
        : {}),
    };

    setMarkers((prev) => [...prev, newMarker]);
    // Keep tool selected for rapid placement; user can press Escape to drop
  }

  function removeMarker(idx: number) {
    setMarkers((prev) => prev.filter((_, i) => i !== idx));
  }

  // Convert a single PDF marker → screen coordinates for rendering
  function markerScreenRect(m: FieldMarker) {
    if (!pageDims) return { left: 0, top: 0, width: 0, height: 0 };
    const scale = pageDims.renderWidth / pageDims.pdfWidth;
    return {
      left: m.x * scale,
      top: (pageDims.pdfHeight - m.y - m.height) * scale,
      width: m.width * scale,
      height: m.height * scale,
    };
  }

  return (
    <div className="flex gap-3 h-[70vh]">
      {/* ─── Toolbox ─────────────────── */}
      <div className="w-56 shrink-0 space-y-3 overflow-y-auto pr-1">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Assign to signer</Label>
          <select
            value={activeRecipient}
            onChange={(e) => setActiveRecipient(e.target.value)}
            className="w-full text-xs rounded-md border bg-background px-2 py-1.5"
          >
            {signers.map((s, idx) => (
              <option key={idx} value={String(idx + 1)}>
                {s.role_label || `Signer ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Drop a field</Label>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Pick a field, then click on the document where it should go. Click again to place more of the same.
          </p>
          <div className="space-y-1">
            {palette.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedField(selectedField?.id === p.id ? null : p)}
                className={`w-full text-left text-xs px-2 py-1.5 rounded-md border transition ${
                  selectedField?.id === p.id
                    ? `${p.bg} ring-2 ring-offset-1 ring-primary`
                    : `${p.bg} opacity-70 hover:opacity-100`
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {selectedField && (
            <div className="text-[10px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
              <MousePointer2 className="w-2.5 h-2.5 inline mr-1" />
              Click on the PDF to place "{selectedField.label}". Press Escape to deselect.
            </div>
          )}
        </div>

        <div className="space-y-1.5 pt-2 border-t">
          <Label className="text-xs text-muted-foreground">
            Markers on page {activePage} ({pageMarkers.length})
          </Label>
          {pageMarkers.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">No markers on this page yet.</p>
          ) : (
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {pageMarkers.map((m) => {
                const idxInAll = markers.indexOf(m);
                const fieldDef = palette.find((p) => p.id === m.field_id);
                const signerLabel = m.recipient_id
                  ? signers[Number(m.recipient_id) - 1]?.role_label ?? `Signer ${m.recipient_id}`
                  : "any";
                return (
                  <div
                    key={idxInAll}
                    className="flex items-center justify-between text-[10px] px-1.5 py-0.5 rounded bg-muted/50"
                  >
                    <span className="truncate">
                      {fieldDef?.label || m.field_id}
                      {m.recipient_id && (
                        <span className="text-muted-foreground"> · {signerLabel}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMarker(idxInAll)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── PDF preview + overlay ─────── */}
      <div className="flex-1 flex flex-col min-h-0 border rounded-md bg-muted/20">
        {/* Page nav */}
        <div className="flex items-center justify-between border-b bg-card px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">
            {pageCount > 0 ? `Page ${activePage} of ${pageCount}` : "Loading PDF…"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={activePage <= 1}
              onClick={() => setActivePage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={activePage >= pageCount}
              onClick={() => setActivePage((p) => Math.min(pageCount, p + 1))}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Scrollable canvas area */}
        <div className="flex-1 overflow-auto flex items-start justify-center p-3">
          <Document
            file={pdfUrl}
            onLoadSuccess={({ numPages }) => {
              setPageCount(numPages);
              setLoading(false);
            }}
            onLoadError={(e) => {
              console.error("PDF load error", e);
              setLoading(false);
            }}
            loading={
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-12">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading PDF…
              </div>
            }
          >
            <div
              ref={pageContainerRef}
              className="relative inline-block shadow-lg cursor-crosshair"
              onClick={handlePageClick}
              style={{ cursor: selectedField ? "crosshair" : "default" }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSelectedField(null);
              }}
              tabIndex={0}
            >
              <Page
                pageNumber={activePage}
                onLoadSuccess={(page) => {
                  // PDF native size in points; rendered size in CSS pixels
                  setPageDims({
                    pdfWidth: page.originalWidth ?? page.width,
                    pdfHeight: page.originalHeight ?? page.height,
                    renderWidth: page.width,
                    renderHeight: page.height,
                  });
                }}
                renderAnnotationLayer={false}
                renderTextLayer={false}
                width={Math.min(800, window.innerWidth - 360)}
              />

              {/* Marker overlay (only the active page's markers) */}
              {pageDims && pageMarkers.map((m) => {
                const rect = markerScreenRect(m);
                const fieldDef = palette.find((p) => p.id === m.field_id);
                return (
                  <div
                    key={`${m.page}-${m.x}-${m.y}-${m.field_id}`}
                    className={`absolute border-2 ${fieldDef?.bg ?? "bg-amber-100 border-amber-400 text-amber-800"} rounded text-[10px] px-1 flex items-center justify-center pointer-events-none`}
                    style={{
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                    }}
                  >
                    <span className="truncate">{fieldDef?.label || m.field_id}</span>
                  </div>
                );
              })}
            </div>
          </Document>
          {!loading && pageCount === 0 && (
            <p className="text-sm text-muted-foreground py-12">
              Couldn't load the PDF preview. The fields will still be applied — they just won't be positioned visually (signature defaults to the bottom-right of the last page).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
