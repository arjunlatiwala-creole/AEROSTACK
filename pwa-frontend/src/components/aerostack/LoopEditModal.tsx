import type React from "react";
import type { AerostackLoops } from "@enterprise/common";
import { LoopFormModal } from "./LoopFormModal";

interface Props {
  open: boolean;
  onClose: () => void;
  loop: AerostackLoops.Loop;
  onSuccess?: () => void;
}

export const LoopEditModal: React.FC<Props> = ({
  open,
  onClose,
  loop,
  onSuccess,
}) => {
  return (
    <LoopFormModal
      open={open}
      onClose={onClose}
      loop={loop}
      mode="edit"
      onSuccess={onSuccess}
    />
  );
};
