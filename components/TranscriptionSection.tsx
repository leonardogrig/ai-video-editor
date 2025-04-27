import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatLanguage } from '@/app/utils/formatters';
import { SpeechSegment } from './types';

interface TranscriptionSectionProps {
  selectedLanguage: string;
  supportedLanguages: string[];
  isTranscribing: boolean;
  transcriptionProgress: string;
  onLanguageChange: (language: string) => void;
  onTranscribe: () => void;
  transcribedSegments: SpeechSegment[] | null;
  onDiscardTranscription: () => void;
  transcriptionError: string | null;
  onFilterWithAI?: () => void;
  isFiltering?: boolean;
}

export function TranscriptionSection({
  selectedLanguage,
  supportedLanguages,
  isTranscribing,
  transcriptionProgress,
  onLanguageChange,
  onTranscribe,
  transcribedSegments,
  onDiscardTranscription,
  transcriptionError,
  onFilterWithAI,
  isFiltering = false
}: TranscriptionSectionProps) {
  
  if (transcribedSegments) {
    return (
      <div className="mt-4 p-4 border-2 border-black bg-gray-50">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold">Transcription Complete</h3>
          <div className="flex gap-2">
            <Button 
              onClick={onFilterWithAI} 
              disabled={isFiltering}
              className="neo-brutalism-button bg-blue-500 hover:bg-blue-600 text-white"
              size="sm"
            >
              {isFiltering ? "Filtering..." : "Filter with AI"}
            </Button>
            <Button 
              onClick={onDiscardTranscription} 
              className="neo-brutalism-button bg-red-500 hover:bg-red-600 text-white"
              size="sm"
            >
              Discard Transcription
            </Button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="mt-4 p-4 border-2 border-black bg-gray-50">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold">Transcribe Speech</h3>
      </div>
      <p className="text-xs text-gray-600 mt-1 mb-3">
        Convert speech to text using Whisper AI. This requires FFmpeg to be installed on your system.
      </p>
      
      <div className="flex flex-col mb-4">
        <Label htmlFor="language" className="text-xs mb-1">Language</Label>
        <Select
          value={selectedLanguage}
          onValueChange={onLanguageChange}
        >
          <SelectTrigger className="w-full" id="language">
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            {supportedLanguages.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {formatLanguage(lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500 mt-1">
          Select the primary language spoken in the video (defaults to English)
        </p>
      </div>
      
      <Button
        onClick={onTranscribe}
        disabled={isTranscribing}
        className="neo-brutalism-button w-full"
      >
        {isTranscribing ? "Transcribing..." : "Transcribe Speech"}
      </Button>
      
      {isTranscribing && (
        <div className="flex flex-col items-center justify-center mt-4">
          <p className="text-sm text-gray-500">{transcriptionProgress}</p>
        </div>
      )}
      
      {transcriptionError && (
        <div className="mt-4 p-4 border-2 border-red-300 bg-red-50 rounded">
          <h3 className="text-sm font-bold text-red-700">Transcription Error</h3>
          <p className="text-red-600 text-sm mt-1">{transcriptionError}</p>
        </div>
      )}
    </div>
  );
} 