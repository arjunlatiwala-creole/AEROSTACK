import { PlusIcon } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../ui/button";
import { LoopFormModal } from "./LoopFormModal";
import { useWriteAccess } from "@/hooks/useWriteAccess";

export const LoopCreateButton: React.FC = () => {
	const [open, setOpen] = useState(false);
	const { canWrite } = useWriteAccess();
	
	if (!canWrite) return null;

	return (
		<>
			<Button onClick={() => setOpen(true)} variant="default">
				<PlusIcon /> Create Loop
			</Button>
			<LoopFormModal open={open} onClose={() => setOpen(false)} />
		</>
	);
};
