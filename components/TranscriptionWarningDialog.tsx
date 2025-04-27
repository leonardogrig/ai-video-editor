import { Button } from '@/components/ui/button';

interface TranscriptionWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function TranscriptionWarningDialog({ isOpen, onClose, onConfirm }: TranscriptionWarningDialogProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md">
        <h3 className="text-lg font-bold mb-2">Warning</h3>
        <p className="mb-4">Re-processing the video will delete the current transcription. Are you sure you want to continue?</p>
        <div className="flex justify-end gap-2">
          <Button 
            onClick={onClose} 
            variant="outline"
            className="neo-brutalism-button"
          >
            Cancel
          </Button>
          <Button 
            onClick={onConfirm} 
            className="neo-brutalism-button bg-red-500 hover:bg-red-600 text-white"
          >
            Delete Transcription & Continue
          </Button>
        </div>
      </div>
    </div>
  );
} 