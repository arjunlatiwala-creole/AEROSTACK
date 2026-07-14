/**
 * Public Aerostack signing landing page.
 *
 * Route: /sign/:envelopeId?token=<sign-link-token>
 * Auth:  None — the HMAC-signed token in the URL is the only credential.
 *
 * Flow (everything happens inside Aerostack — no DocuSign UI):
 *   1. Resolve token → fetch envelope, document title, signers, intake form
 *   2. Show intake form (sender-defined questions)
 *   3. Show signature pad (signer draws with mouse/finger)
 *   4. Show "I agree" checkbox + typed legal name
 *   5. Submit → Aerostack bakes form values + signature image into the PDF,
 *      adds an audit footer, locks it in S3 with Object Lock COMPLIANCE
 *   6. Show success screen with download link
 */

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  ShieldCheck,
  PenSquare,
  CheckCircle2,
  Loader2,
  AlertCircle,
  XCircle,
  Eraser,
  Lock,
  Check,
  ChevronDown,
} from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import toast from "react-hot-toast";
import {
  resolveSignLink,
  completeSignLink,
  type SignLinkResolveResponse,
} from "@/api/document-host";

type Step = "form" | "sign" | "done";

export const SIGNATURE_FONTS = [
  { id: "Caveat", name: "Style 1", family: "'Caveat', cursive" },
  { id: "Sacramento", name: "Style 2", family: "'Sacramento', cursive" },
  { id: "Great Vibes", name: "Style 3", family: "'Great Vibes', cursive" },
  { id: "Parisienne", name: "Style 4", family: "'Parisienne', cursive" },
];

export default function SignDocument() {
  const { envelopeId } = useParams<{ envelopeId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [envelope, setEnvelope] = useState<SignLinkResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("form");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completionMessage, setCompletionMessage] = useState("");

  // Three signature modes: draw on canvas, upload PNG/JPG, or type a name
  // rendered in a cursive font and rasterised to PNG.
  type SignatureMode = "draw" | "upload" | "type";
  const [sigMode, setSigMode] = useState<SignatureMode>("draw");
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [hasDrawnSignature, setHasDrawnSignature] = useState(false);
  const [uploadedSignature, setUploadedSignature] = useState<string | null>(null);
  const [typedSignature, setTypedSignature] = useState("");
  const [selectedFont, setSelectedFont] = useState("Caveat");
  const [showFontDropdown, setShowFontDropdown] = useState(false);

  useEffect(() => {
    if (!envelopeId || !token) {
      setError("This sign link is missing required information. Please use the link from your email.");
      setLoading(false);
      return;
    }
    setLoading(true);
    resolveSignLink(envelopeId, token)
      .then((res) => {
        setEnvelope(res);
        // Auto-prefill any date field with today (signer can override).
        // This matches the spec: "auto-detect date" — the date the signer
        // is filling the form is captured automatically.
        const initialValues: Record<string, string> = {};
        const today = new Date().toISOString().slice(0, 10);
        for (const f of res.intake_form_fields ?? []) {
          if (f.type === "date") initialValues[f.id] = today;
        }
        if (res.intake_form_responses?.responses) {
          Object.assign(initialValues, res.intake_form_responses.responses);
        }
        setFormValues(initialValues);
        setTypedName(res.me.name ?? "");
        setTypedSignature(res.me.name ?? "");
      })
      .catch((err) => {
        const msg = err?.response?.data?.error ?? err?.message ?? "Unable to load signing page.";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [envelopeId, token]);

  const handleContinueToSign = () => {
    const myFields = (envelope?.intake_form_fields ?? []).filter(
      (f) => !f.recipient_id || f.recipient_id === envelope?.me?.recipient_id
    );
    const missing = myFields
      .filter((f) => f.required && !(formValues[f.id] ?? "").trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      toast.error(`Please fill in: ${missing.join(", ")}`);
      return;
    }
    setStep("sign");
  };

  const clearSignature = () => {
    sigRef.current?.clear();
    setHasDrawnSignature(false);
  };

  /** Renders a typed name in a cursive font onto a canvas → PNG data URL. */
  const renderTypedSignature = (name: string): string => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";
    // Resolve font family
    const family = SIGNATURE_FONTS.find((f) => f.id === selectedFont)?.family ?? "'Caveat', cursive";
    ctx.font = `italic 72px ${family}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL("image/png");
  };

  /** Returns the current signature as a PNG data URL based on the active mode. */
  const captureSignature = (): string | null => {
    if (sigMode === "draw") {
      if (!hasDrawnSignature || sigRef.current?.isEmpty()) return null;
      return sigRef.current!.toDataURL("image/png");
    }
    if (sigMode === "upload") {
      return uploadedSignature;
    }
    if (sigMode === "type") {
      const text = typedSignature.trim();
      if (!text) return null;
      return renderTypedSignature(text);
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!envelopeId || !envelope) return;
    const dataUrl = captureSignature();
    if (!dataUrl) {
      const msg =
        sigMode === "draw"
          ? "Please draw your signature in the box above."
          : sigMode === "upload"
            ? "Please upload an image of your signature."
            : "Please type your name to generate a signature.";
      toast.error(msg);
      return;
    }
    if (!typedName.trim()) {
      toast.error("Please type your full legal name.");
      return;
    }
    if (!agreed) {
      toast.error("Please confirm you agree to sign electronically.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await completeSignLink(envelopeId, token, {
        intake_responses: formValues,
        signature_data_url: dataUrl,
        typed_name: typedName.trim(),
      });
      setCompletionMessage(res.message);
      setStep("done");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(e.response?.data?.error ?? e.message ?? "Unable to complete signing.");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render branches ────────────────────────────────────────────────────

  if (loading) {
    return (
      <CenteredCard>
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading signing request…</p>
        </div>
      </CenteredCard>
    );
  }



  if (error || !envelope) {
    return (
      <CenteredCard>
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold">Unable to open signing request</h1>
          <p className="text-sm text-muted-foreground max-w-md">{error ?? "Unknown error."}</p>
          <p className="text-xs text-muted-foreground">
            If this link came from email, the request may have been cancelled or expired. Contact the sender for a new link.
          </p>
        </div>
      </CenteredCard>
    );
  }

  if (envelope.already_signed || step === "done") {
    return (
      <CenteredCard>
        <div className="text-center space-y-4 py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold mb-2">Signed</h1>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              {completionMessage || "Your signature has been recorded and the document is locked in Aerostack storage."}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-4 border-t">
            <Lock className="w-3 h-3" />
            <span>Sealed and secured · cannot be deleted</span>
          </div>
        </div>
      </CenteredCard>
    );
  }

  if (envelope.waiting_on_earlier_signers) {
    return (
      <CenteredCard>
        <div className="text-center space-y-4 py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold">Waiting for earlier signers</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            We'll email you the moment it's your turn to sign "{envelope.document_title}". You can close this tab.
          </p>
          <div className="border-t pt-4 mt-4">
            <p className="text-xs text-muted-foreground mb-2">Signing order</p>
            <div className="space-y-1">
              {envelope.signers.map((s) => (
                <div
                  key={s.role_label}
                  className="flex items-center justify-between text-xs px-3 py-1.5 rounded-md border"
                >
                  <span>
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="text-muted-foreground">({s.role_label})</span>
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${s.status?.toLowerCase() === "completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                      }`}
                  >
                    {s.status || "pending"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CenteredCard>
    );
  }

  if (envelope.status === "completed") {
    return (
      <CenteredCard>
        <div className="text-center space-y-4 py-8">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h1 className="text-xl font-semibold">Already complete</h1>
          <p className="text-sm text-muted-foreground">All parties have signed this document.</p>
        </div>
      </CenteredCard>
    );
  }

  if (envelope.status === "voided" || envelope.status === "declined") {
    return (
      <CenteredCard>
        <div className="text-center space-y-4 py-8">
          <XCircle className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">This request was cancelled</h1>
          <p className="text-sm text-muted-foreground">Contact the sender for more details.</p>
        </div>
      </CenteredCard>
    );
  }

  const fields = (envelope.intake_form_fields ?? []).filter(
    (f) => !f.recipient_id || f.recipient_id === envelope.me?.recipient_id
  );

  // ─── Form step ──────────────────────────────────────────────────────────
  if (step === "form") {
    return (
      <Shell envelope={envelope} step={step}>
        <CardContent className="pt-6 space-y-5">
          {/* Other parties */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">All signers</Label>
            <div className="space-y-1">
              {envelope.signers.map((s) => (
                <div
                  key={s.role_label}
                  className="flex items-center justify-between text-sm border rounded-md px-3 py-1.5"
                >
                  <span>
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="text-muted-foreground text-xs">({s.role_label})</span>
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${s.status?.toLowerCase() === "completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                      }`}
                  >
                    {s.status || "pending"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {fields.length > 0 ? (
            <div className="space-y-3 pt-2 border-t">
              <Label className="text-xs text-muted-foreground">Please fill in the following</Label>
              {fields.map((f) => (
                <div key={f.id} className="space-y-1">
                  <Label className="text-sm">
                    {f.label}
                    {f.required && <span className="text-destructive ml-0.5">*</span>}
                  </Label>
                  {f.type === "textarea" ? (
                    <Textarea
                      value={formValues[f.id] ?? ""}
                      onChange={(e) => setFormValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      placeholder={f.placeholder}
                      rows={3}
                    />
                  ) : (
                    <Input
                      type={f.type}
                      value={formValues[f.id] ?? ""}
                      onChange={(e) => setFormValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      placeholder={f.placeholder}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic border-t pt-3">
              No additional information requested. Click continue to review and sign.
            </div>
          )}

          <Button onClick={handleContinueToSign} className="w-full" size="lg">
            <PenSquare className="w-4 h-4 mr-2" />
            Continue to signature
          </Button>
        </CardContent>
      </Shell>
    );
  }

  // ─── Sign step ──────────────────────────────────────────────────────────
  return (
    <Shell envelope={envelope} step={step}>
      <CardContent className="pt-6 space-y-5">
        {/* Recap of form values */}
        {fields.length > 0 && (
          <div className="bg-muted/40 rounded-md p-3 text-xs space-y-1">
            <div className="font-medium mb-1">Your responses</div>
            {fields.map((f) => (
              <div key={f.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="font-medium truncate">{formValues[f.id] || "—"}</span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setStep("form")}
              className="text-xs text-primary hover:underline mt-1"
            >
              Edit responses
            </button>
          </div>
        )}

        {/* Typed legal name */}
        <div className="space-y-1.5">
          <Label className="text-sm">
            Type your full legal name <span className="text-destructive">*</span>
          </Label>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Jane Doe"
          />
          <p className="text-[11px] text-muted-foreground">
            This name will appear on the signed document alongside your drawn signature.
          </p>
        </div>

        {/* Signature input — three modes */}
        <div className="space-y-2">
          <Label className="text-sm">
            Your signature <span className="text-destructive">*</span>
          </Label>

          {/* Mode tabs */}
          <div className="flex border rounded-md overflow-hidden text-xs">
            {([
              { id: "draw", label: "✍️ Draw" },
              { id: "type", label: "🅰️ Type" },
              { id: "upload", label: "📤 Upload" },
            ] as const).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSigMode(m.id)}
                className={`flex-1 py-1.5 transition ${sigMode === m.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Draw */}
          {sigMode === "draw" && (
            <div className="border-2 border-dashed rounded-md bg-white relative overflow-hidden">
              <SignatureCanvas
                ref={(r) => { sigRef.current = r; }}
                canvasProps={{
                  className: "w-full h-44 cursor-crosshair touch-none",
                  style: { touchAction: "none" },
                }}
                penColor="rgb(0, 0, 0)"
                backgroundColor="rgba(255,255,255,1)"
                onEnd={() => setHasDrawnSignature(true)}
              />
              {!hasDrawnSignature && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-xs text-muted-foreground">Sign here with your mouse or finger</p>
                </div>
              )}
              {hasDrawnSignature && (
                <button
                  type="button"
                  onClick={clearSignature}
                  className="absolute top-1.5 right-1.5 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 bg-white/90 rounded px-1.5 py-0.5"
                >
                  <Eraser className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
          )}

          {/* Type */}
          {sigMode === "type" && (
            <div className="space-y-4">
              <Input
                value={typedSignature}
                onChange={(e) => setTypedSignature(e.target.value)}
                placeholder="Type your full name to generate a signature"
                className="font-medium"
              />
              {typedSignature.trim() && (
                <div className="flex items-center justify-between">
                  <div className="relative inline-block text-left">
                    <button
                      type="button"
                      onClick={() => setShowFontDropdown(!showFontDropdown)}
                      className="inline-flex items-center justify-between gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <span>Choose font</span>
                      <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                    </button>

                    {showFontDropdown && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setShowFontDropdown(false)} />
                        <div className="absolute left-0 mt-1 w-64 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-40 border border-gray-200 py-1">
                          {SIGNATURE_FONTS.map((font) => {
                            const isSelected = selectedFont === font.id;
                            return (
                              <button
                                key={font.id}
                                type="button"
                                onClick={() => {
                                  setSelectedFont(font.id);
                                  setShowFontDropdown(false);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                              >
                                <div className="w-4 flex items-center justify-center">
                                  {isSelected && (
                                    <Check className="h-4 w-4 text-emerald-600 font-bold" />
                                  )}
                                </div>
                                <span
                                  style={{ fontFamily: font.family }}
                                  className="text-xl text-black truncate flex-1 block"
                                >
                                  {typedSignature}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              {typedSignature.trim() && (
                <div className="space-y-1">
                  <div className="border-b border-gray-200 pb-8 flex items-center justify-start min-h-[100px]">
                    <span
                      style={{ fontFamily: SIGNATURE_FONTS.find(f => f.id === selectedFont)?.family ?? "'Caveat', cursive" }}
                      className="text-4xl text-black"
                    >
                      {typedSignature}
                    </span>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Your typed name will be rendered in the selected signature style and embedded in the document.
              </p>
            </div>
          )}

          {/* Upload */}
          {sigMode === "upload" && (
            <div className="space-y-2">
              {uploadedSignature ? (
                <div className="border-2 border-dashed rounded-md bg-white p-4 flex items-center justify-center min-h-[88px] relative">
                  <img
                    src={uploadedSignature}
                    alt="Uploaded signature"
                    className="max-h-32 object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => setUploadedSignature(null)}
                    className="absolute top-1.5 right-1.5 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 bg-white/90 rounded px-1.5 py-0.5"
                  >
                    <Eraser className="w-3 h-3" /> Remove
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-md cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors">
                  <p className="text-xs text-muted-foreground">Click to upload a signature image</p>
                  <p className="text-[10px] text-muted-foreground mt-1">PNG or JPG · transparent background works best</p>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2 * 1024 * 1024) {
                        toast.error("Signature image must be smaller than 2 MB.");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => setUploadedSignature(reader.result as string);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        {/* Consent */}
        <div className="space-y-2 border-t pt-4">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <span>
              I agree to sign "{envelope.document_title}" electronically. I understand this signature is legally binding and will be permanently sealed in Aerostack storage.
            </span>
          </label>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep("form")} disabled={submitting}>
            Back
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !agreed || !typedName.trim()}
            className="flex-1"
            size="lg"
          >
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            {submitting ? "Sealing document…" : "Sign and seal"}
          </Button>
        </div>
      </CardContent>
    </Shell>
  );
}

// ─── Layout helpers ────────────────────────────────────────────────────────

function Shell({
  envelope,
  step,
  children,
}: {
  envelope: SignLinkResolveResponse;
  step: Step;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-3">
        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <StepDot active={step === "form"} done={step !== "form"} label="1. Review" />
          <span className="w-8 h-px bg-border" />
          <StepDot active={step === "sign"} done={step === "done"} label="2. Sign" />
          <span className="w-8 h-px bg-border" />
          <StepDot active={false} done={step === "done"} label="3. Done" />
        </div>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2 text-emerald-700 mb-2 text-xs font-medium">
              <ShieldCheck className="w-4 h-4" />
              SIGNATURE REQUEST
            </div>
            <CardTitle>{envelope.document_title}</CardTitle>
            <CardDescription>
              Sent by <span className="font-medium">{envelope.sender_email}</span> · Signing as{" "}
              <span className="font-medium">{envelope.me.role_label}</span>
            </CardDescription>
          </CardHeader>
          {children}
        </Card>

        <p className="text-[11px] text-muted-foreground text-center">
          Powered by Aerostack · Your signature is captured, hashed (SHA-256), and locked with AWS S3 Object Lock for 10 years.
        </p>
      </div>
    </div>
  );
}

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 ${active ? "text-foreground font-medium" : done ? "text-emerald-700" : "text-muted-foreground"
        }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${active ? "bg-primary" : done ? "bg-emerald-500" : "bg-muted-foreground/30"
          }`}
      />
      {label}
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6">{children}</CardContent>
      </Card>
    </div>
  );
}

