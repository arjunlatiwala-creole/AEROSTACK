import {
  LOOP_CATEGORIES,
  LOOP_STATUSES,
  LOOP_TYPES,
  type LoopCategory,
  type LoopStatus,
  type LoopType,
  PRIORITIES,
  type AerostackLoops,
} from "@enterprise/common";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import type React from "react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { fetchAuthSession } from "aws-amplify/auth";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateLoop } from "@/hooks/useLoops";
import { type LoopFormData, loopFormSchema } from "@/schemas/loop";
import { TagInput } from "./TagInput";
import { EmailTagInput } from "./EmailTagInput";
import { OwnerEmailInput } from "./AutoComplate";

interface Props {
  open: boolean;
  onClose: () => void;
  loop?: AerostackLoops.Loop;
  mode?: "create" | "edit";
  onSuccess?: () => void;
}

// Helper function to get category description
const getCategoryDescription = (category: LoopCategory): string => {
  const descriptions: Record<LoopCategory, string> = {
    OAL: "🎓 Organizational accredited learning programs",
    ENG: "⚙️ Engineering/technical delivery work",
    MSP: "🔧 Managed service provider projects",
    BD: "💼 Business development & customer projects",
    GTM: "📈 Go-to-market initiatives",
    "OPS:Finance": "💰 Finance operations",
    "OPS:HR": "👥 HR & people operations",
    "OPS:SalesOps": "📊 Sales operations",
    "PRO-DEV": "🌱 Professional development programs",
    ADVISORY: "💡 Advisory & consulting work",
    ONBOARDING: "📋 Onboarding tasks & compliance document requirements",
    COMMS_FLUENCY: "💬 Communication & domain fluency",
    "INT:PRODUCT": "🏗️ Internal product & feature development",
    "INT:AUTO": "🤖 Process automation & workflow efficiency",
    "INT:INFRA": "🌐 Platform stability & cloud infrastructure",
    "INT:DOCS": "📚 Documentation & knowledge management",
  };
  return descriptions[category] || category;
};

// Helper to group categories
const getCategoryGroup = (category: LoopCategory): string => {
  if (category === "OAL" || category === "PRO-DEV" || category === "ONBOARDING" || category === "COMMS_FLUENCY")
    return "Learning & Development";
  if (category === "ENG" || category === "MSP") return "Technical Delivery";
  if (category === "BD" || category === "GTM") return "Customer Projects";
  if (category.startsWith("INT:")) return "Internal Projects";
  return "Internal Operations";
};

// Human-friendly display names for categories
const getCategoryDisplayName = (category: LoopCategory): string => {
  const names: Partial<Record<LoopCategory, string>> = {
    OAL: "OAL",
    "PRO-DEV": "PRO-DEV",
    ONBOARDING: "ONBOARDING",
    COMMS_FLUENCY: "FLUENCY",
  };
  return names[category] || category;
};

const contributorsToInput = (contributors?: AerostackLoops.Contributor[]) => {
  if (!contributors || contributors.length === 0) return [];
  return contributors.map((c) => c.email);
};

export const LoopFormModal: React.FC<Props> = ({
  open,
  onClose,
  loop,
  mode,
  onSuccess,
}) => {
  const isEdit = (mode ?? (loop ? "edit" : "create")) === "edit";
  const createLoopMutation = useCreateLoop({
    successMessage: isEdit ? "Loop updated successfully" : undefined,
    errorMessage: isEdit ? "Failed to update loop" : undefined,
  });
  const [openDate, setOpenDate] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    const loadEmail = async () => {
      try {
        if (
          import.meta.env.DEV &&
          import.meta.env.VITE_AWS_USER_POOL_ID === "us-east-1_XXXXXXXXX"
        ) {
          setUserEmail("dev@local");
          return;
        }
        const session = await fetchAuthSession({ forceRefresh: false });
        const sessionEmail =
          session.tokens?.idToken?.payload?.email ||
          session.tokens?.accessToken?.payload?.username ||
          "";
        setUserEmail(String(sessionEmail || ""));
      } catch (err) {
        console.warn("Failed to load session email", err);
      }
    };
    loadEmail();
  }, []);

  const form = useForm({
    resolver: zodResolver(loopFormSchema),
    defaultValues: {
      title: loop?.title ?? "",
      description: loop?.description ?? "",
      loop_type: (loop?.loop_type ?? "KEY_RESULT") as LoopType,
      category: (loop?.category ?? "BD") as LoopCategory,
      owner_email: loop?.owner_email ?? "",
      target_completion_date: loop?.target_completion_date ?? "",
      priority: loop?.priority ?? 3,
      status: (loop?.status ?? "BACKLOG") as LoopStatus,
      status_comment: "",
      contributors_input: contributorsToInput(loop?.contributors) as string[],
      tags: loop?.tags ?? [],
      // jira_key: loop?.jira_key ?? "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      title: loop?.title ?? "",
      description: loop?.description ?? "",
      loop_type: (loop?.loop_type ?? "KEY_RESULT") as LoopType,
      category: (loop?.category ?? "BD") as LoopCategory,
      owner_email: loop?.owner_email ?? "",
      target_completion_date: loop?.target_completion_date ?? "",
      priority: loop?.priority ?? 3,
      status: (loop?.status ?? "BACKLOG") as LoopStatus,
      status_comment: "",
      contributors_input: contributorsToInput(loop?.contributors) as string[],
      tags: loop?.tags ?? [],
      // jira_key: loop?.jira_key ?? "",
    });
  }, [form, loop, open]);

  // Watch status to detect changes in edit mode
  const currentStatus = form.watch("status");
  const originalStatus = loop?.status;
  const statusChanged = isEdit && currentStatus !== originalStatus;
  // Show status comment: always in create mode, only when status changes in edit mode
  const showStatusComment = !isEdit || statusChanged;

  const onSubmit = async (values: LoopFormData) => {
    console.log("values", values);

    // Validate status_comment is required when it should be shown
    if (
      showStatusComment &&
      (!values.status_comment || values.status_comment.trim() === "")
    ) {
      form.setError("status_comment", {
        type: "manual",
        message: "Status comment is required",
      });
      return;
    }

    // Parse contributors from array
    const contributors =
      values.contributors_input && values.contributors_input.length > 0
        ? values.contributors_input.map((email) => ({ email, share: 0.1 })) // Default share of 0.1 per contributor
        : isEdit && loop?.contributors?.length
          ? []
          : undefined;

    const submitData = {
      ...values,
      contributors,
      contributors_input: undefined, // Remove the input field from submission
      tags:
        values.tags && values.tags.length > 0
          ? values.tags
          : isEdit
            ? []
            : undefined,
      loop_id: isEdit ? loop?.loop_id : undefined,
      status_comment: showStatusComment ? values.status_comment : undefined,
      updated_by: userEmail || undefined,
    };

    console.log("submitData", submitData);
    createLoopMutation.mutate(submitData as any, {
      onSuccess: () => {
        onSuccess?.();
        form.reset({
          title: "",
          description: "",
          loop_type: "KEY_RESULT",
          category: "BD",
          owner_email: "",
          target_completion_date: "",
          priority: 3,
          status: "BACKLOG",
          status_comment: "",
          contributors_input: [],
          tags: [],
          // jira_key: "",
        });
        onClose();
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Loop" : "Create New Loop"}</DialogTitle>
          <p className="text-sm text-gray-600 mt-1">
            {isEdit
              ? "Update the loop details. Changes will be saved immediately."
              : "Assign a goal to a team member. This will appear on their personal dashboard."}
          </p>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input
              {...form.register("title")}
              placeholder="e.g., Complete AWS SA Associate Certification"
            />
            {form.formState.errors.title && (
              <p className="text-sm text-red-500">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          {/* Owner */}
          <div className="space-y-2">
            <Label>Owner Email (Single-Threaded Owner) *</Label>
            <Controller
              name="owner_email"
              control={form.control}
              render={({ field }) => <OwnerEmailInput {...field} />}
            />
            <p className="text-xs text-gray-500">
              The person responsible for this outcome. They'll see this on their
              dashboard.
            </p>
            {form.formState.errors.owner_email && (
              <p className="text-sm text-red-500">
                {form.formState.errors.owner_email.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              {...form.register("description")}
              rows={3}
              placeholder="What needs to be accomplished and why it matters…"
            />
            <p className="text-xs text-gray-500">
              Provide context so the owner understands the goal clearly.
            </p>
          </div>

          {/* Type + Category */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select
                onValueChange={(v) => form.setValue("loop_type", v as LoopType)}
                defaultValue={form.getValues("loop_type")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOOP_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                OBJECTIVE = Big goal, KEY_RESULT = Measurable outcome
              </p>
            </div>

            <div className="space-y-2">
              <Label>Category *</Label>
              <Select
                onValueChange={(v) =>
                  form.setValue("category", v as LoopCategory)
                }
                defaultValue={form.getValues("category")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {/* Learning & Development */}
                  <div className="px-2 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50">
                    Learning & Development
                  </div>
                  {LOOP_CATEGORIES.filter(
                    (c) => c === "OAL" || c === "PRO-DEV" || c === "ONBOARDING" || c === "COMMS_FLUENCY",
                  ).map((c) => (
                    <SelectItem key={c} value={c}>
                      <div className="flex flex-col">
                        <span>{getCategoryDisplayName(c)}</span>
                        <span className="text-xs text-gray-500">
                          {getCategoryDescription(c)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}

                  {/* Technical Delivery */}
                  <div className="px-2 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 mt-2">
                    Technical Delivery
                  </div>
                  {LOOP_CATEGORIES.filter(
                    (c) => c === "ENG" || c === "MSP",
                  ).map((c) => (
                    <SelectItem key={c} value={c}>
                      <div className="flex flex-col">
                        <span>{c}</span>
                        <span className="text-xs text-gray-500">
                          {getCategoryDescription(c)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}

                  {/* Customer Projects */}
                  <div className="px-2 py-1.5 text-xs font-semibold text-green-700 bg-green-50 mt-2">
                    Customer Projects
                  </div>
                  {LOOP_CATEGORIES.filter((c) => c === "BD" || c === "GTM").map(
                    (c) => (
                      <SelectItem key={c} value={c}>
                        <div className="flex flex-col">
                          <span>{c}</span>
                          <span className="text-xs text-gray-500">
                            {getCategoryDescription(c)}
                          </span>
                        </div>
                      </SelectItem>
                    ),
                  )}
                  {/* Internal Projects */}
                  <div className="px-2 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 mt-2">
                    Internal Projects
                  </div>
                  {LOOP_CATEGORIES.filter((c) => c.startsWith("INT:")).map(
                    (c) => (
                      <SelectItem key={c} value={c}>
                        <div className="flex flex-col">
                          <span>{c}</span>
                          <span className="text-xs text-gray-500">
                            {getCategoryDescription(c)}
                          </span>
                        </div>
                      </SelectItem>
                    ),
                  )}
                  {/* Internal Operations */}
                  <div className="px-2 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 mt-2">
                    Internal Operations
                  </div>
                  {LOOP_CATEGORIES.filter(
                    (c) => c.startsWith("OPS:") || c === "ADVISORY",
                  ).map((c) => (
                    <SelectItem key={c} value={c}>
                      <div className="flex flex-col">
                        <span>{c}</span>
                        <span className="text-xs text-gray-500">
                          {getCategoryDescription(c)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Choose the type of work: Learning, Delivery, Customer, or
                Internal
              </p>
            </div>
          </div>

          {/* Priority + Target Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority *</Label>
              <Select
                onValueChange={(v) => form.setValue("priority", Number(v))}
                defaultValue={String(form.getValues("priority"))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      <div className="flex items-center justify-between w-full">
                        <span>P{p}</span>
                        <span className="text-xs text-gray-500 ml-2">
                          {p === 1
                            ? "Critical"
                            : p === 2
                              ? "High"
                              : p === 3
                                ? "Medium"
                                : p === 4
                                  ? "Low"
                                  : "Minimal"}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                P1 = Highest priority, P5 = Lowest priority
              </p>
            </div>

            <div className="space-y-2">
              <Label>Target Completion Date *</Label>
              <Controller
                name="target_completion_date"
                control={form.control}
                render={({ field: { value, onChange } }) => (
                  <Popover open={openDate} onOpenChange={setOpenDate}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left"
                      >
                        {value ? format(new Date(value), "PPP") : "Select Date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={value ? new Date(value) : undefined}
                        disabled={(date) =>
                          date < new Date(new Date().setHours(0, 0, 0, 0))
                        }
                        onSelect={(date) => {
                          if (!date) {
                            onChange(undefined);
                            return;
                          }
                          onChange(format(date, "yyyy-MM-dd"));
                          setOpenDate(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              />
              <p className="text-xs text-gray-500">
                When should this be completed? (e.g., March 1st for
                certifications)
              </p>
              {form.formState.errors.target_completion_date && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.target_completion_date.message}
                </p>
              )}
            </div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Status *</Label>
            <Select
              onValueChange={(v) => form.setValue("status", v as LoopStatus)}
              defaultValue={form.getValues("status")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOOP_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status === "BACKLOG"
                      ? "Backlog"
                      : status === "IN_PROGRESS"
                        ? "In Progress"
                        : status === "IN_QA_REVIEW"
                          ? "In QA Review"
                          : status === "COMPLETED"
                            ? "Completed"
                            : status === "DELAY_INCOMPLETED"
                              ? "Delay & Incompleted"
                              : status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">Current status of this loop</p>
          </div>

          {/* Status Comment - visible in create mode always, in edit mode only when status changes */}
          {showStatusComment && (
            <div className="space-y-2">
              <Label>Status Comment *</Label>
              <Textarea
                {...form.register("status_comment")}
                rows={2}
                placeholder={
                  isEdit
                    ? "What changed? e.g., Completed first module, moving to next phase…"
                    : "Initial note, e.g., Starting AWS Lambda learning…"
                }
              />
              <p className="text-xs text-gray-500">
                {isEdit
                  ? "Describe what progress was made or why the status is changing. This will be recorded in the progress history."
                  : "Add a note about this loop's starting point. This will be the first entry in the progress history."}
              </p>
              {form.formState.errors.status_comment && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.status_comment.message}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Contributors (optional)</Label>
            <Controller
              name="contributors_input"
              control={form.control}
              render={({ field }) => (
                <EmailTagInput
                  value={(field.value as string[]) ?? []}
                  onChange={field.onChange}
                  placeholder="Add contributor email..."
                />
              )}
            />
            <p className="text-xs text-gray-500">
              Add contributor emails. Each contributor will receive a default
              share of 0.1 (10%).
            </p>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags (optional)</Label>
            <Controller
              name="tags"
              control={form.control}
              render={({ field }) => (
                <TagInput
                  value={field.value ?? []}
                  onChange={(vals) => {
                    field.onChange(vals);
                    console.log("vals", vals);
                  }}
                  placeholder="revgen, channel/aws, q1-2026"
                />
              )}
            />
            <p className="text-xs text-gray-500">
              Add tags to organize and filter loops (e.g., revgen, channel/aws)
            </p>
          </div>

          {/* Jira Key */}
          {/* <div className="space-y-2">
            <Label>Jira Key (optional)</Label>
            <Input {...form.register("jira_key")} placeholder="Aerostack-123" />
            <p className="text-xs text-gray-500">
              Link to Jira epic or ticket for project tracking
            </p>
          </div> */}

          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={createLoopMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createLoopMutation.isPending}>
              {createLoopMutation.isPending
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save"
                  : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
