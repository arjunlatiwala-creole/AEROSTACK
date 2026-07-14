import { UserPlus } from "lucide-react";
import HiringPipelineBoard from "@/components/aerostack/hiring/HiringPipelineBoard";

export default function DashboardHiringTools() {
    return (
        <div className="min-h-screen bg-background p-8">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-4xl font-bold flex items-center gap-3">
                    <UserPlus className="w-10 h-10" />
                    Hiring
                </h1>
            </div>
            <HiringPipelineBoard />
        </div>
    );
}
