import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AudioPlayer } from '@/components/ui/AudioPlayer';
import { SpeechControls } from './SpeechControls';
import { DialogControls, SpeechSegment } from './types';
import { Progress } from '@/components/ui/progress';

interface UploadProgressOverlayProps {
  progress: number;
  message: string;
  processingStatus?: string;
}

function UploadProgressOverlay({ progress, message, processingStatus }: UploadProgressOverlayProps) {
  return (
    <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center z-20 p-4">
      <div className="w-full max-w-md">
        <h3 className="text-xl font-bold mb-2 text-center">{message}</h3>
        <Progress value={progress} className="h-2 mb-2" />
        <p className="text-center text-sm text-gray-600">{progress}% complete</p>
        {processingStatus && (
          <p className="text-center text-sm text-blue-600 mt-2 font-medium">
            Status: {processingStatus}
          </p>
        )}
      </div>
    </div>
  );
}

interface SilenceRemovalCardProps {
  videoFile: File | null;
  isLoading: boolean;
  error: string | null;
  silenceSegments: SpeechSegment[] | null;
  audioUrl: string | null;
  dialogControls: DialogControls;
  isDialogProcessing: boolean;
  transcribedSegments: SpeechSegment[] | null;
  isTranscribing: boolean;
  transcriptionProgress: string;
  transcriptionError: string | null;
  selectedLanguage: string;
  supportedLanguages: string[];
  onRemoveSilence: () => void;
  onApplyChanges: () => void;
  onDialogControlChange: (key: keyof DialogControls, value: number) => void;
  onTranscribe: () => void;
  onLanguageChange: (language: string) => void;
  onDiscardTranscription: () => void;
  onDialogOpen: () => void;
  filteredSegments?: SpeechSegment[] | null;
  progressButton?: React.ReactNode;
  uploadProgress?: number;
  uploadMessage?: string;
  processingStatus?: string;
}

export function SilenceRemovalCard({
  videoFile,
  isLoading,
  error,
  silenceSegments,
  audioUrl,
  dialogControls,
  isDialogProcessing,
  transcribedSegments,
  isTranscribing,
  transcriptionProgress,
  transcriptionError,
  selectedLanguage,
  supportedLanguages,
  onRemoveSilence,
  onApplyChanges,
  onDialogControlChange,
  onTranscribe,
  onLanguageChange,
  onDiscardTranscription,
  onDialogOpen,
  filteredSegments,
  progressButton,
  uploadProgress = 0,
  uploadMessage = "",
  processingStatus = ""
}: SilenceRemovalCardProps) {
  const showUploadProgress = isLoading && (uploadProgress > 0 || processingStatus !== "");
  
  return (
    <Card className="w-full neo-brutalism-card relative">
      {showUploadProgress && (
        <UploadProgressOverlay 
          progress={uploadProgress} 
          message={uploadMessage} 
          processingStatus={processingStatus}
        />
      )}
      
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Silence Removal</CardTitle>
        <CardDescription>
          Detect and remove silent parts of your video using WebRTC Voice Activity Detection.
        </CardDescription>
      </CardHeader>
      <CardContent></CardContent>
      <CardFooter className="flex flex-col items-start space-y-4 w-full">
        {!silenceSegments && (
          <Button onClick={onRemoveSilence} disabled={isLoading || !videoFile} className="neo-brutalism-button w-full">
            {isLoading ? (
              <>
                {uploadProgress > 0 ? `Uploading ${uploadProgress}%` : processingStatus || 'Processing...'}
              </>
            ) : 'Remove Silence'}
          </Button>
        )}
        
        {error && (
          <div className="w-full p-3 bg-red-100 border-2 border-red-500 text-red-800">
            {error}
          </div>
        )}
        
        {silenceSegments && audioUrl && (
          <div className="w-full border-t-2 border-black pt-4">
            <h3 className="text-lg font-bold mb-4">Speech Detection Results</h3>
            
            {!transcribedSegments && (
              <p className="mb-4 text-sm bg-yellow-50 p-3 border-l-4 border-yellow-400">
                Adjust the controls below to fine-tune the speech detection. 
                Any changes will be applied after clicking the Apply Changes button.
              </p>
            )}
            
            {transcribedSegments && (
              <p className="mb-4 text-sm bg-green-50 p-3 border-l-4 border-green-400">
                Transcription complete! All speech segments have been transcribed using OpenAI's Whisper model.
              </p>
            )}
            
            {!transcribedSegments && (
              <SpeechControls 
                dialogControls={dialogControls}
                audioUrl={audioUrl}
                selectedLanguage={selectedLanguage}
                supportedLanguages={supportedLanguages}
                isDialogProcessing={isDialogProcessing}
                isTranscribing={isTranscribing}
                transcriptionProgress={transcriptionProgress}
                onControlChange={onDialogControlChange}
                onApplyChanges={onApplyChanges}
                onTranscribe={onTranscribe}
                onLanguageChange={onLanguageChange}
                progressButton={progressButton}
              />
            )}
            
            {transcribedSegments && (
              <div className="mt-4 p-4 border-2 border-black bg-gray-50">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold">Transcription Complete</h3>
                  <Button 
                    onClick={onDiscardTranscription} 
                    className="neo-brutalism-button bg-red-500 hover:bg-red-600 text-white"
                    size="sm"
                  >
                    Discard Transcription
                  </Button>
                </div>
              </div>
            )}
            
            {transcriptionError && (
              <div className="mt-4 p-4 border-2 border-red-300 bg-red-50 rounded">
                <h3 className="text-sm font-bold text-red-700">Transcription Error</h3>
                <p className="text-red-600 text-sm mt-1">{transcriptionError}</p>
              </div>
            )}
            
            <div className="mt-4 relative">
              <AudioPlayer 
                audioUrl={audioUrl}
                speechSegments={!!transcribedSegments ? transcribedSegments : silenceSegments}
                showTranscriptions={!!transcribedSegments}
              />
              
              {/* Overlay spinner when processing */}
              {isDialogProcessing && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                  <div className="flex flex-col items-center">
                    <div className="animate-spin h-10 w-10 border-4 border-blue-500 rounded-full border-t-transparent mb-2"></div>
                    <p className="text-sm text-gray-700">Processing audio...</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardFooter>
    </Card>
  );
} 