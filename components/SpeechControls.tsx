import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Volume1, Volume2 } from "lucide-react";
import { formatLanguage } from "@/app/utils/formatters";
import { DialogControls } from "./types";

export type TranscriptionProviderOption = {
  id: string;
  label: string;
  description: string;
};

export const TRANSCRIPTION_PROVIDERS: TranscriptionProviderOption[] = [
  {
    id: "groq",
    label: "Groq — Whisper large-v3 turbo",
    description: "Fast and free-tier friendly. Produces Whisper-style retakes.",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs Scribe v1",
    description: "Higher accuracy, fewer retakes. Paid; needs ELEVENLABS_API_KEY.",
  },
];

interface SpeechControlsProps {
  dialogControls: DialogControls;
  audioUrl: string;
  selectedLanguage: string;
  supportedLanguages: string[];
  isDialogProcessing: boolean;
  isTranscribing: boolean;
  transcriptionProgress: string;
  transcriptionProvider: string;
  isCreatingRequest?: boolean;
  isReadingResponse?: boolean;
  aiExchangeStatus?: string | null;
  aiExchangePath?: string | null;
  aiExchangePrompt?: string | null;
  cachedTranscriptionAvailable?: boolean;
  onControlChange: (key: keyof DialogControls, value: number) => void;
  onApplyChanges: () => void;
  onTranscribe: () => void;
  onLanguageChange: (language: string) => void;
  onProviderChange: (providerId: string) => void;
  onCreateThresholdRequest?: () => void;
  onSetThresholdFromResponse?: () => void;
  progressButton?: React.ReactNode;
}

interface DurationFieldProps {
  id: string;
  label: string;
  description: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

function DurationField({
  id,
  label,
  description,
  value,
  min = 0,
  max = 10000,
  step = 1,
  onChange,
}: DurationFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>
      <p className="text-xs text-gray-500">{description}</p>
      <div className="relative">
        <Input
          id={id}
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isNaN(next)) onChange(next);
          }}
          className="pr-28 font-mono"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-mono">
          milliseconds
        </span>
      </div>
    </div>
  );
}

export function SpeechControls({
  dialogControls,
  audioUrl,
  selectedLanguage,
  supportedLanguages,
  isDialogProcessing,
  isTranscribing,
  transcriptionProgress,
  transcriptionProvider,
  isCreatingRequest = false,
  isReadingResponse = false,
  aiExchangeStatus = null,
  aiExchangePath = null,
  aiExchangePrompt = null,
  cachedTranscriptionAvailable = false,
  onControlChange,
  onApplyChanges,
  onTranscribe,
  onLanguageChange,
  onProviderChange,
  onCreateThresholdRequest,
  onSetThresholdFromResponse,
  progressButton,
}: SpeechControlsProps) {
  const activeProvider =
    TRANSCRIPTION_PROVIDERS.find((p) => p.id === transcriptionProvider) ??
    TRANSCRIPTION_PROVIDERS[0];
  return (
    <div className="mt-4 p-4 border-2 border-black bg-gray-50">
      <h3 className="text-sm font-bold mb-3">Adjust Speech Detection</h3>

      <div className="space-y-6">
        <section className="border-l-2 border-black/20 pl-4 space-y-4">
          <h4 className="text-base font-bold">Silence Duration</h4>

          <DurationField
            id="removeSilencesLongerThanMs"
            label="Remove Silences Longer Than"
            description="Minimum duration (ms) to remove silences."
            value={dialogControls.removeSilencesLongerThanMs}
            min={0}
            max={10000}
            step={10}
            onChange={(v) => onControlChange("removeSilencesLongerThanMs", v)}
          />

          <DurationField
            id="keepTalksLongerThanMs"
            label="Keep Talks Longer Than"
            description="Minimum duration (ms) to retain talk segments."
            value={dialogControls.keepTalksLongerThanMs}
            min={0}
            max={10000}
            step={10}
            onChange={(v) => onControlChange("keepTalksLongerThanMs", v)}
          />
        </section>

        <section className="border-l-2 border-black/20 pl-4 space-y-4">
          <h4 className="text-base font-bold">Margin</h4>

          <DurationField
            id="marginBeforeMs"
            label="Margin before by"
            description="Silent time after noise to ensure smooth speech end."
            value={dialogControls.marginBeforeMs}
            min={0}
            max={2000}
            step={10}
            onChange={(v) => onControlChange("marginBeforeMs", v)}
          />

          <DurationField
            id="marginAfterMs"
            label="Margin after by"
            description="Silent time before noise to ensure smooth speech start."
            value={dialogControls.marginAfterMs}
            min={0}
            max={2000}
            step={10}
            onChange={(v) => onControlChange("marginAfterMs", v)}
          />
        </section>

        <section className="border-l-2 border-black/20 pl-4 space-y-3">
          <div>
            <h4 className="text-base font-bold">Noise Threshold</h4>
            <p className="text-xs text-gray-500">
              Set the sound level to identify silences, visible below.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Volume1 className="h-5 w-5 text-gray-500 shrink-0" />
            <div className="flex-1 flex flex-col items-center gap-1">
              <Slider
                id="noiseThresholdDb"
                value={[dialogControls.noiseThresholdDb]}
                min={-80}
                max={0}
                step={1}
                onValueChange={(value) =>
                  onControlChange("noiseThresholdDb", value[0])
                }
              />
              <span className="text-xs font-mono text-gray-600">
                {dialogControls.noiseThresholdDb}dB
              </span>
            </div>
            <Volume2 className="h-5 w-5 text-gray-500 shrink-0" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onCreateThresholdRequest}
                disabled={isCreatingRequest || !onCreateThresholdRequest}
              >
                {isCreatingRequest ? "Creating…" : "Create JSON"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onSetThresholdFromResponse}
                disabled={isReadingResponse || !onSetThresholdFromResponse}
              >
                {isReadingResponse ? "Reading…" : "Set from Response"}
              </Button>
            </div>
            {aiExchangePath && (
              <p className="text-[11px] font-mono text-gray-500 break-all text-center">
                {aiExchangePath}
              </p>
            )}
            {aiExchangePrompt && (
              <div className="w-full flex items-stretch gap-2">
                <code
                  className="flex-1 text-xs font-mono bg-white border-2 border-black px-2 py-1.5 select-all break-all"
                  onClick={(e) => {
                    const range = document.createRange();
                    range.selectNodeContents(e.currentTarget);
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                  }}
                >
                  {aiExchangePrompt}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(aiExchangePrompt);
                  }}
                  className="text-xs font-bold px-2 py-1 border-2 border-black bg-yellow-200 hover:bg-yellow-300"
                >
                  Copy
                </button>
              </div>
            )}
            {aiExchangeStatus && (
              <p className="text-xs text-gray-600 text-center">
                {aiExchangeStatus}
              </p>
            )}
          </div>
        </section>

        <div className="flex justify-center gap-4 mt-6 items-center flex-col">
          <Button
            onClick={onApplyChanges}
            disabled={isDialogProcessing}
            className="neo-brutalism-button bg-green-500 hover:bg-green-600 text-white"
          >
            {isDialogProcessing ? (
              <>
                <div className="animate-spin h-5 w-5 border-2 border-white rounded-full border-t-transparent mr-2"></div>
                Processing...
              </>
            ) : (
              "Apply Changes"
            )}
          </Button>

          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              {isTranscribing ? (
                <>{progressButton}</>
              ) : (
                <Button
                  onClick={onTranscribe}
                  disabled={isTranscribing}
                  className="neo-brutalism-button bg-blue-500 hover:bg-blue-600 text-white"
                >
                  {cachedTranscriptionAvailable
                    ? "Transcribe (cached — instant)"
                    : "Transcribe"}
                </Button>
              )}
            </div>
            {cachedTranscriptionAvailable && !isTranscribing && (
              <p className="text-[11px] text-gray-500">
                Existing transcription found in{" "}
                <code>public/transcriptions/</code> — clicking Transcribe
                reuses it instead of re-processing.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 border-t-2 border-gray-200 pt-4">
          <div className="flex items-center justify-between mb-2">
            <Label
              htmlFor="transcribeProvider"
              className="text-sm font-medium"
            >
              Transcription Provider
            </Label>
            <span className="text-xs text-gray-500">
              Using: {activeProvider.label.split(" — ")[0]}
            </span>
          </div>
          <Select value={transcriptionProvider} onValueChange={onProviderChange}>
            <SelectTrigger className="w-full" id="transcribeProvider">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {TRANSCRIPTION_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500 mt-1">{activeProvider.description}</p>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <Label
              htmlFor="transcribeLanguage"
              className="text-sm font-medium"
            >
              Transcription Language
            </Label>
            <span className="text-xs text-gray-500">
              Selected: {formatLanguage(selectedLanguage)}
            </span>
          </div>
          <Select value={selectedLanguage} onValueChange={onLanguageChange}>
            <SelectTrigger className="w-full" id="transcribeLanguage">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {supportedLanguages.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {formatLanguage(lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500 mt-1">
            Choose the primary language spoken in the video for more accurate
            transcription
          </p>
        </div>
      </div>

      {isDialogProcessing && (
        <div className="flex items-center justify-center mt-4 text-sm text-gray-500">
          This may take a moment for longer videos...
        </div>
      )}

      {isTranscribing && (
        <div className="flex flex-col items-center justify-center mt-4">
          <p className="text-sm text-gray-500">{transcriptionProgress}</p>
        </div>
      )}
    </div>
  );
}
