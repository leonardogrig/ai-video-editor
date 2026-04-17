import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatLanguage } from '@/app/utils/formatters';
import { getRawTranscriptionPath } from '@/app/services/videoService';
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
  onImportEdited?: () => void;
  isImporting?: boolean;
  importStatus?: string | null;
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
  onImportEdited,
  isImporting = false,
  importStatus = null,
}: TranscriptionSectionProps) {
  const [rawPath, setRawPath] = useState<string | null>(null);
  const [rawPathNote, setRawPathNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!transcribedSegments) return;
    let cancelled = false;
    getRawTranscriptionPath()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ready") {
          setRawPath(result.path);
          setRawPathNote(null);
        } else if (result.status === "missing") {
          setRawPath(null);
          setRawPathNote(
            `No raw JSON found in ${result.dir}. The transcription cache will be written there once you finish transcribing.`
          );
        } else if (result.status === "ambiguous") {
          setRawPath(result.candidates[0]);
          setRawPathNote(
            `Multiple JSONs found; using the first one. Remove the extras if this is wrong.`
          );
        }
      })
      .catch(() => {
        if (!cancelled) setRawPathNote("Could not resolve raw JSON path.");
      });
    return () => {
      cancelled = true;
    };
  }, [transcribedSegments]);

  const prompt = rawPath
    ? `${rawPath} — use the filter-transcription skill to produce the final edited.json`
    : null;

  const handleCopyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fall through — user can still select the text manually
    }
  };

  if (transcribedSegments) {
    return (
      <div className="mt-4 p-4 border-2 border-black bg-gray-50">
        {prompt && (
          <div className="mb-3 p-3 border-2 border-black bg-yellow-100">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold">Claude Code prompt</span>
              <Button
                onClick={handleCopyPrompt}
                className="neo-brutalism-button bg-black text-yellow-300 hover:bg-gray-800"
                size="sm"
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap break-all select-all">
              {prompt}
            </pre>
            <p className="text-[11px] text-gray-700 mt-1">
              Paste this into Claude Code. It will write{" "}
              <code className="font-mono">edited.json</code> next to the raw file.
              Then click Import below.
            </p>
          </div>
        )}
        {rawPathNote && !prompt && (
          <p className="text-xs text-gray-700 mb-2">{rawPathNote}</p>
        )}
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-bold">Transcription Complete</h3>
          <div className="flex gap-2">
            <Button
              onClick={onImportEdited}
              disabled={isImporting}
              className="neo-brutalism-button bg-blue-500 hover:bg-blue-600 text-white"
              size="sm"
            >
              {isImporting ? "Importing..." : "Import from Claude Code"}
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
        {importStatus && (
          <p className="text-xs text-gray-700">{importStatus}</p>
        )}
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