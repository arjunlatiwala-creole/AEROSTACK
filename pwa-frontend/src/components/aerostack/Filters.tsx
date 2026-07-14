import type {
  LoopCategory,
  LoopPhase,
  LoopStatus,
  LoopType,
} from "@enterprise/common";
import {
  LOOP_CATEGORIES,
  LOOP_PHASES,
  LOOP_STATUSES,
  LOOP_TYPES,
  PRIORITIES,
} from "@enterprise/common";
import { format } from "date-fns";
import {
  ArrowUpDown,
  CalendarIcon,
  ChevronDown,
  ChevronUp,
  Filter,
  X,
} from "lucide-react";
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Input } from "../ui/input";

interface LoopListParams {
  category?: LoopCategory;
  status?: LoopStatus;
  phase?: LoopPhase;
  target_before?: string;

  loop_type?: LoopType;
  owner_email?: string;
  priority?: number;

  sort_by?: "priority" | "target_date" | "created_at" | "updated_at";
  sort_order?: "asc" | "desc";
}

interface Props {
  value: LoopListParams;
  onChange: (v: LoopListParams) => void;
  currentUserEmail?: string;
}

const Filters: React.FC<Props> = ({ value, onChange, currentUserEmail }) => {
  const set = (patch: Partial<LoopListParams>) =>
    onChange({ ...value, ...patch } as LoopListParams);

  const [openTargetBefore, setOpenTargetBefore] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [ownerInput, setOwnerInput] = React.useState(value.owner_email || "");
  React.useEffect(() => {
    setOwnerInput(value.owner_email || "");
  }, [value.owner_email]);

  const activeFilterCount = [
    value.category,
    value.status,
    value.phase,
    value.target_before,
    value.loop_type,
    value.owner_email,
    value.priority,
  ].filter(Boolean).length;

  const clearAll = () => onChange({});

  const toggleMyLoops = () => {
    if (value.owner_email === currentUserEmail) {
      set({ owner_email: undefined });
    } else {
      set({ owner_email: currentUserEmail });
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Filters</span>
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="h-4 px-2 text-xs">
                    {activeFilterCount}
                  </Badge>
                )}
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 ml-1" />
                ) : (
                  <ChevronDown className="h-4 w-4 ml-1" />
                )}
              </Button>
            </CollapsibleTrigger>

            {currentUserEmail && (
              <Button
                type="button"
                variant={
                  value.owner_email === currentUserEmail ? "default" : "outline"
                }
                size="sm"
                onClick={toggleMyLoops}
                className="h-9"
              >
                My Loops
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Sort controls */}
            <Select
              value={value.sort_by || "updated_at"}
              onValueChange={(v) =>
                set({
                  sort_by: v as LoopListParams["sort_by"],
                })
              }
            >
              <SelectTrigger className="h-9 w-[180px] shadow-none">
                <ArrowUpDown className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_at">Last Updated</SelectItem>
                <SelectItem value="created_at">Created Date</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set({
                  sort_order: value.sort_order === "asc" ? "desc" : "asc",
                })
              }
              className="h-9 px-3"
            >
              {value.sort_order === "asc" ? "↑" : "↓"}
            </Button>

            {activeFilterCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearAll}
                className="h-9 text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            )}
          </div>
        </div>

        <CollapsibleContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Category */}
            <Select
              value={value.category || "_none"}
              onValueChange={(v) =>
                set({
                  category: v === "_none" ? undefined : (v as LoopCategory),
                })
              }
            >
              <SelectTrigger className="h-9 w-full shadow-none">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">All Categories</SelectItem>
                {LOOP_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c === "COMMS_FLUENCY" ? "FLUENCY" : c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status */}
            <Select
              value={value.status || "_none"}
              onValueChange={(v) =>
                set({
                  status: v === "_none" ? undefined : (v as LoopStatus),
                })
              }
            >
              <SelectTrigger className="h-9 w-full shadow-none">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">All Statuses</SelectItem>
                {LOOP_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Phase */}
            <Select
              value={value.phase || "_none"}
              onValueChange={(v) =>
                set({
                  phase: v === "_none" ? undefined : (v as LoopPhase),
                })
              }
            >
              <SelectTrigger className="h-9 w-full shadow-none">
                <SelectValue placeholder="Phase" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">All Phases</SelectItem>
                {LOOP_PHASES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Loop Type */}
            <Select
              value={value.loop_type || "_none"}
              onValueChange={(v) =>
                set({
                  loop_type: v === "_none" ? undefined : (v as LoopType),
                })
              }
            >
              <SelectTrigger className="h-9 w-full shadow-none">
                <SelectValue placeholder="Loop Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">All Types</SelectItem>
                {LOOP_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Priority */}
            <Select
              value={value.priority?.toString() || "_none"}
              onValueChange={(v) =>
                set({
                  priority: v === "_none" ? undefined : Number(v),
                })
              }
            >
              <SelectTrigger className="h-9 w-full shadow-none">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="_none">All Priorities</SelectItem>
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

            {/* Target Before Date */}
            <Popover open={openTargetBefore} onOpenChange={setOpenTargetBefore}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 w-full justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {value.target_before
                    ? format(new Date(value.target_before), "PPP")
                    : "Target before"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={
                    value.target_before
                      ? new Date(value.target_before)
                      : undefined
                  }
                  onSelect={(date) => {
                    set({
                      target_before: date
                        ? format(date, "yyyy-MM-dd")
                        : undefined,
                    });
                    setOpenTargetBefore(false);
                  }}
                />
              </PopoverContent>
            </Popover>

            {/* Owner Email */}
            <div className="flex gap-2 w-full">
              <Input
                type="email"
                placeholder="email@enterprise.io"
                value={ownerInput}
                onChange={(e) => setOwnerInput(e.target.value)}
                className="h-9 flex-1"
              />
              <Button
                type="button"
                size="sm"
                className="h-9"
                onClick={() =>
                  set({
                    owner_email: ownerInput || undefined,
                  })
                }
              >
                Load
              </Button>
            </div>
          </div>

          {/* Active filters display */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              {value.category && (
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">
                  Category: {value.category === "COMMS_FLUENCY" ? "FLUENCY" : value.category}
                  <button
                    type="button"
                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      set({ category: undefined });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {value.status && (
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">
                  Status: {value.status}
                  <button
                    type="button"
                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      set({ status: undefined });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {value.phase && (
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">
                  Phase: {value.phase}
                  <button
                    type="button"
                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      set({ phase: undefined });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {value.loop_type && (
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">
                  Type: {value.loop_type}
                  <button
                    type="button"
                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      set({ loop_type: undefined });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {value.priority && (
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">
                  Priority: {value.priority}
                  <button
                    type="button"
                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      set({ priority: undefined });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {value.target_before && (
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">
                  Before: {format(new Date(value.target_before), "MMM d, yyyy")}
                  <button
                    type="button"
                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      set({ target_before: undefined });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {value.owner_email && value.owner_email !== currentUserEmail && (
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">
                  Owner: {value.owner_email}
                  <button
                    type="button"
                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      set({ owner_email: undefined });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

export default Filters;
