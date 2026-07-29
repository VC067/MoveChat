import React from 'react';
import { Trash2 } from 'lucide-react';

interface DeleteConfirmationProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteConfirmation: React.FC<DeleteConfirmationProps> = ({
  onConfirm,
  onCancel,
}) => {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-5">
          <Trash2 className="w-7 h-7 text-destructive" />
        </div>

        <h2 className="text-lg font-semibold text-foreground mb-2">
          Delete this session?
        </h2>
        <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
          This action cannot be undone.
        </p>

        <div className="space-y-2">
          <button
            onClick={onConfirm}
            className="w-full py-3 px-4 bg-destructive text-destructive-foreground font-semibold rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all text-sm cursor-pointer"
          >
            Delete Session
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 px-4 bg-secondary text-foreground font-medium rounded-2xl hover:bg-accent transition-colors text-sm cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
