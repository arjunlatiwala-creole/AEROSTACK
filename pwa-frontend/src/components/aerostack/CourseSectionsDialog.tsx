import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";
import type { AerostackLoops } from "@enterprise/common";

type MoodleCourse = AerostackLoops.MoodleCourse;

interface CourseSectionsDialogProps {
  open: boolean;
  onClose: () => void;
  course: MoodleCourse | null;
}

export function CourseSectionsDialog({ open, onClose, course }: CourseSectionsDialogProps) {
  if (!course) return null;

  const sections = course.sections || [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-6 gap-4">
        <DialogHeader className="border-b pb-3">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <BookOpen className="h-5 w-5 text-blue-600" />
            Course Sections
          </DialogTitle>
          <p className="text-sm font-semibold text-muted-foreground mt-1 line-clamp-1">
            {course.fullname}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-4 py-2">
          {sections.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No sections found for this course.
            </p>
          ) : (
            <div className="relative border-l border-border pl-4 ml-2 space-y-6">
              {sections.map((section, idx) => {
                const hasSummary = section.summary && section.summary.trim() !== "" && section.summary !== "<p><br></p>";
                
                // Determine clean display name
                let sectionName = section.name || "";
                if (section.section === 0) {
                  sectionName = "General / Introduction";
                } else if (!sectionName || sectionName.toLowerCase() === "new section") {
                  sectionName = `Section ${section.section || idx}`;
                }

                return (
                  <div key={section.id || idx} className="relative group">
                    {/* Timeline Node dot */}
                    <div className="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full border-2 border-background bg-blue-500 group-hover:scale-110 transition-transform" />

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-sm text-foreground">
                          {sectionName}
                        </h4>
                        {section.visible === 0 && (
                          <Badge variant="outline" className="text-[9px] px-1 h-3.5 leading-none">
                            Hidden
                          </Badge>
                        )}
                      </div>
                      
                      {hasSummary ? (
                        <div 
                          className="text-xs text-muted-foreground leading-relaxed rich-text-content prose prose-sm dark:prose-invert max-w-none"
                          dangerouslySetInnerHTML={{ __html: section.summary }}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground/60 italic">
                          No description provided for this section.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
