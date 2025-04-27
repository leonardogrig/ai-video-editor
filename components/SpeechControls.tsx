import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatLanguage } from "@/app/utils/formatters";
import { DialogControls } from "./types";

interface SpeechControlsProps {
  dialogControls: DialogControls;
  audioUrl: string;
  selectedLanguage: string;
  supportedLanguages: string[];
  isDialogProcessing: boolean;
  isTranscribing: boolean;
  transcriptionProgress: string;
  onControlChange: (key: keyof DialogControls, value: number) => void;
  onApplyChanges: () => void;
  onTranscribe: () => void;
  onLanguageChange: (language: string) => void;
  progressButton?: React.ReactNode;
}

export function SpeechControls({
  dialogControls,
  audioUrl,
  selectedLanguage,
  supportedLanguages,
  isDialogProcessing,
  isTranscribing,
  transcriptionProgress,
  onControlChange,
  onApplyChanges,
  onTranscribe,
  onLanguageChange,
  progressButton,
}: SpeechControlsProps) {
  return (
    <div className="mt-4 p-4 border-2 border-black bg-gray-50">
      <h3 className="text-sm font-bold mb-3">Adjust Speech Detection</h3>

      <TooltipProvider>
        <div className="space-y-4">
          <div className="parameter-control">
            <div className="parameter-header">
              <Label htmlFor="dialogVolumeThreshold">Volume Threshold</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-2 cursor-help rounded-full border border-gray-400 px-1 text-xs">
                    ?
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  <p>
                    Frames with volume higher than this percentage are
                    considered speech. Higher values are more selective and will
                    remove more silence.
                  </p>
                </TooltipContent>
              </Tooltip>
              <span className="parameter-value">
                {dialogControls.volumeThreshold}%
              </span>
            </div>
            <Slider
              id="dialogVolumeThreshold"
              value={[dialogControls.volumeThreshold]}
              min={5}
              max={100}
              step={1}
              onValueChange={(value) =>
                onControlChange("volumeThreshold", value[0])
              }
            />
          </div>

          <div className="parameter-control">
            <div className="parameter-header">
              <Label htmlFor="dialogSpeechPaddingMs">Speech Padding</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-2 cursor-help rounded-full border border-gray-400 px-1 text-xs">
                    ?
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  <p>
                    Additional time (in milliseconds) to keep before and after
                    each speech segment.
                  </p>
                </TooltipContent>
              </Tooltip>
              <span className="parameter-value">
                {dialogControls.speechPaddingMs}ms
              </span>
            </div>
            <Slider
              id="dialogSpeechPaddingMs"
              value={[dialogControls.speechPaddingMs]}
              min={0}
              max={500}
              step={10}
              onValueChange={(value) =>
                onControlChange("speechPaddingMs", value[0])
              }
            />
          </div>

          <div className="parameter-control">
            <div className="parameter-header">
              <Label htmlFor="dialogSilencePaddingMs">Silence Padding</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-2 cursor-help rounded-full border border-gray-400 px-1 text-xs">
                    ?
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  <p>
                    Maximum silence duration (in milliseconds) that will be treated as part of a continuous speech segment. Silences shorter than this value will merge adjacent speech segments.
                  </p>
                </TooltipContent>
              </Tooltip>
              <span className="parameter-value">
                {dialogControls.silencePaddingMs}ms
              </span>
            </div>
            <Slider
              id="dialogSilencePaddingMs"
              value={[dialogControls.silencePaddingMs]}
              min={0}
              max={1000}
              step={50}
              onValueChange={(value) =>
                onControlChange("silencePaddingMs", value[0])
              }
            />
          </div>

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

            <div className="flex items-center gap-2">
              {isTranscribing ? (
                <>{progressButton}</>
              ) : (
                <Button
                  onClick={onTranscribe}
                  disabled={isTranscribing}
                  className="neo-brutalism-button bg-blue-500 hover:bg-blue-600 text-white"
                >
                  Transcribe
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 border-t-2 border-gray-200 pt-4">
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
      </TooltipProvider>

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
