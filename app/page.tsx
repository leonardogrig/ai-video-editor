"use client";

import { useState, useRef, useEffect } from "react";
import { UploadCard } from "@/components/UploadCard";
import { SilenceRemovalCard } from "@/components/SilenceRemovalCard";
import { TranscriptionSection } from "@/components/TranscriptionSection";
import { TranscriptionWarningDialog } from "@/components/TranscriptionWarningDialog";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import {
  DialogControls,
  InstallationInstructions,
  SpeechSegment,
  SilenceRemovalParams,
} from "@/components/types";
import { supportedLanguages } from "./constants/languages";
import {
  removeSilence,
  transcribeVideo,
  filterTranscribedSegments,
} from "./services/videoService";
import { neoBrutalismStyles } from "./styles/neo-brutalism";
import { SelectedSegmentsPlayer } from "@/components/SelectedSegmentsPlayer";
import { TranscriptionProgressDialog } from "./components/TranscriptionProgressDialog";
import { TranscriptionProgressButton } from "./components/TranscriptionProgressButton";
import { createXmlFromSegments } from "@/lib/utils";

// Create a custom hook for the transcription progress dialog
function useTranscriptionProgressDialog(
  isTranscribing: boolean,
  transcriptionProgressDetails: any,
  completedTranscriptions: any[]
) {
  const [isProgressDialogOpen, setIsProgressDialogOpen] = useState(false);

  // Button component that can be inserted next to the transcribe button
  const progressButton = isTranscribing ? (
    <TranscriptionProgressButton
      onClick={() => setIsProgressDialogOpen(true)}
      percent={
        transcriptionProgressDetails.totalSegments > 0
          ? Math.round(
              (transcriptionProgressDetails.currentSegment /
                transcriptionProgressDetails.totalSegments) *
                100
            )
          : 0
      }
      completedSegments={completedTranscriptions.length}
      totalSegments={transcriptionProgressDetails.totalSegments}
      status={transcriptionProgressDetails.status}
    />
  ) : null;

  // Dialog component that appears when button is clicked
  const progressDialog = (
    <TranscriptionProgressDialog
      isOpen={isProgressDialogOpen}
      onClose={() => setIsProgressDialogOpen(false)}
      currentSegment={transcriptionProgressDetails.currentSegment}
      totalSegments={transcriptionProgressDetails.totalSegments}
      status={transcriptionProgressDetails.status}
      message={transcriptionProgressDetails.message}
      currentSegmentInfo={transcriptionProgressDetails.currentSegmentInfo}
      result={transcriptionProgressDetails.latestResult}
      completedSegments={completedTranscriptions}
    />
  );

  return { progressButton, progressDialog };
}

interface TranscriptionResult {
  segments: SpeechSegment[];
  processedCount: number;
  totalCount: number;
  error?: string;
  installationInstructions?: InstallationInstructions;
}

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [silenceSegments, setSilenceSegments] = useState<
    SpeechSegment[] | null
  >(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [volumeThreshold, setVolumeThreshold] = useState<number>(35);
  const [paddingDurationMs, setPaddingDurationMs] = useState<number>(0);
  const [speechPaddingMs, setSpeechPaddingMs] = useState<number>(50);
  const [silencePaddingMs, setSilencePaddingMs] = useState<number>(500);

  const [dialogControls, setDialogControls] = useState<DialogControls>({
    volumeThreshold: 35,
    paddingDurationMs: 0,
    speechPaddingMs: 50,
    silencePaddingMs: 500,
  });
  const [isDialogProcessing, setIsDialogProcessing] = useState(false);

  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState<string>(
    "Processing video and preparing transcription..."
  );
  const [transcribedSegments, setTranscribedSegments] = useState<
    SpeechSegment[] | null
  >(null);
  const [showTranscriptionWarning, setShowTranscriptionWarning] =
    useState<boolean>(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null
  );
  const [selectedLanguage, setSelectedLanguage] = useState<string>("english");

  const [totalSegmentDuration, setTotalSegmentDuration] = useState<number>(0);
  const [originalDuration, setOriginalDuration] = useState<number>(0);

  const [installationInstructions, setInstallationInstructions] =
    useState<InstallationInstructions | null>(null);

  const [filteredSegments, setFilteredSegments] = useState<
    SpeechSegment[] | null
  >(null);
  const [isFiltering, setIsFiltering] = useState<boolean>(false);
  const [filteringError, setFilteringError] = useState<string | null>(null);

  const [filterModel, setFilterModel] = useState<string | undefined>(undefined);

  const [transcriptionProgressDetails, setTranscriptionProgressDetails] =
    useState<{
      currentSegment: number;
      totalSegments: number;
      status: string;
      message: string;
      currentSegmentInfo?: {
        start: string;
        end: string;
        duration: string;
      };
      latestResult?: string;
    }>({
      currentSegment: 0,
      totalSegments: 0,
      status: "idle",
      message: "",
    });

  const [completedTranscriptions, setCompletedTranscriptions] = useState<
    Array<{
      segment: SpeechSegment;
      result: string;
    }>
  >([]);

  const videoRef = useRef<HTMLVideoElement>(null);

  const { progressButton, progressDialog } = useTranscriptionProgressDialog(
    isTranscribing,
    transcriptionProgressDetails,
    completedTranscriptions
  );

  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);

  // Add new state variables for upload
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadMessage, setUploadMessage] = useState<string>("");
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [uploadInfo, setUploadInfo] = useState<{
    filePath: string;
    fileName: string;
    fileSize: number;
    sessionId: string;
  } | null>(null);

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    fileInfo?: { fileName: string; filePath: string }
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setVideoSrc(URL.createObjectURL(file));
      setSilenceSegments(null);
      setAudioUrl(null);
      setError(null);
      setFilteredSegments(null);

      // Store file name and path information
      if (fileInfo) {
        setVideoFileName(fileInfo.fileName);
        setVideoFilePath(fileInfo.filePath);
      } else {
        setVideoFileName(file.name);

        // Use same path format as in UploadCard - generic, not system specific
        const filePath = `file://localhost/videos/${encodeURIComponent(
          file.name
        )}`;
        setVideoFilePath(filePath);
      }
    }
  };

  const handleTranscribe = async () => {
    if (!silenceSegments || isTranscribing) return;

    setIsTranscribing(true);
    setTranscriptionProgress("0%");
    setTranscriptionError(null);
    setUploadProgress(0);
    setUploadMessage("");

    try {
      const result = await transcribeVideo(
        videoFile!,
        silenceSegments,
        selectedLanguage,
        (progressData) => {
          if (progressData.type === "upload_progress") {
            setUploadProgress(progressData.progress || 0);
            setUploadMessage(progressData.message || "Uploading video...");
          }

          if (progressData.type === "status") {
            setProcessingStatus(progressData.message || "");
          }

          if (progressData.type === "segment_processing") {
            const percent = progressData.percent || 0;
            setTranscriptionProgress(`${percent}%`);

            setTranscriptionProgressDetails({
              currentSegment: progressData.currentSegment || 0,
              totalSegments: progressData.totalSegments || 0,
              status: progressData.status || "Processing",
              message: progressData.message || `Processing segment ${progressData.currentSegment || 0}...`,
              currentSegmentInfo: progressData.currentSegmentInfo,
              latestResult: progressData.latestResult,
            });
          }

          if (progressData.type === "segment_complete") {
            if (progressData.segment && progressData.result) {
              setCompletedTranscriptions(prev => [
                ...prev,
                { segment: progressData.segment, result: progressData.result }
              ]);
            }
            setTranscriptionProgressDetails(prev => ({
              ...prev,
              status: progressData.status || "Segment Complete",
              message: progressData.message || `Completed segment ${progressData.currentSegment || 0}`,
              latestResult: progressData.result,
            }));
          }

          if (progressData.type === "complete") {
            setTranscriptionProgress("100%");
            setUploadProgress(0);
            setTranscriptionProgressDetails({
              currentSegment: 0,
              totalSegments: 0,
              status: "complete",
              message: "Transcription finished.",
              latestResult: undefined,
              currentSegmentInfo: undefined,
            });
          }
        },
        uploadInfo || undefined
      );

      const typedResult = result as { segments?: SpeechSegment[] };

      if (typedResult.segments) {
        setTranscribedSegments(typedResult.segments);
      }
    } catch (error) {
      console.error("Error transcribing:", error);
      setTranscriptionError(
        error instanceof Error ? error.message : "An error occurred"
      );
    } finally {
      setIsTranscribing(false);
      setTranscriptionProgress("");
      setProcessingStatus("");
    }
  };

  const handleFilterWithAI = async () => {
    if (!transcribedSegments) return;

    setIsFiltering(true);
    setFilteringError(null);
    setFilterModel(undefined);

    try {
      const result = await filterTranscribedSegments(transcribedSegments);

      if (result.model) {
        setFilterModel(result.model);
      }

      if (result.filteredSegments) {
        setFilteredSegments(result.filteredSegments);

        if (result.warning) {
          setFilteringError(`Warning: ${result.warning}`);
        } else if (result.error) {
          setFilteringError(`Note: ${result.error}`);
        }

        const originalCount = transcribedSegments.length;
        const filteredCount = result.filteredSegments.length;

        if (originalCount === filteredCount && !result.warning && !result.error) {
          setFilteringError(
            "AI did not filter out any segments. All segments were kept as is."
          );
        }
      } else {
        setFilteringError(
          "Failed to get filtered segments from the AI. Please try again."
        );
      }
    } catch (error) {
      console.error("Error filtering segments:", error);
      setFilteringError(
        error instanceof Error
          ? error.message
          : "An error occurred during AI filtering"
      );
      setFilteredSegments(null);
    } finally {
      setIsFiltering(false);
    }
  };

  const handleUpdateFilteredSegments = (updatedSegments: SpeechSegment[]) => {
    setFilteredSegments(updatedSegments);
  };

  const handleRemoveSilence = async () => {
    if (transcribedSegments) {
      setShowTranscriptionWarning(true);
      return;
    }

    if (!videoFile) return;

    setIsLoading(true);
    setError(null);
    setSilenceSegments(null);
    setAudioUrl(null);
    setFilteredSegments(null);
    setUploadProgress(0);
    setUploadMessage("");
    setProcessingStatus("Initializing...");
    setUploadInfo(null);

    try {
      const result = await removeSilence(
        videoFile,
        {
          volumeThreshold,
          paddingDurationMs: 0,
          speechPaddingMs,
          silencePaddingMs,
        },
        (progressData) => {
          if (progressData.type === "status") {
            setProcessingStatus(progressData.status || "");
            setUploadMessage(progressData.message || "");
          }

          if (progressData.type === "upload_progress") {
            setUploadProgress(progressData.progress || 0);
            setUploadMessage(progressData.message || "Uploading video...");
          }
        }
      );

      setSilenceSegments(result.segments);
      setAudioUrl(result.audioUrl);

      if (result.uploadInfo) {
        setUploadInfo(result.uploadInfo);
      }

      if (result.segments && result.segments.length > 0) {
        const totalSegmentDuration = result.segments.reduce(
          (acc, segment) => acc + (segment.end - segment.start),
          0
        );
        setTotalSegmentDuration(totalSegmentDuration);

        const lastSegment = result.segments[result.segments.length - 1];
        setOriginalDuration(lastSegment.end);
      }
    } catch (error) {
      console.error("Error removing silence:", error);
      setError(
        error instanceof Error
          ? error.message
          : "An error occurred while processing the video"
      );
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
      setProcessingStatus("");
    }
  };

  const confirmTranscriptionRemoval = () => {
    setShowTranscriptionWarning(false);
    setTranscribedSegments(null);
    setFilteredSegments(null);
    setUploadInfo(null);

    if (!videoFile) return;

    setIsLoading(true);
    setError(null);
    setSilenceSegments(null);
    setAudioUrl(null);
    setProcessingStatus("Initializing...");

    removeSilence(
      videoFile,
      {
        volumeThreshold,
        paddingDurationMs: 0,
        speechPaddingMs,
        silencePaddingMs,
      },
      (progressData) => {
        if (progressData.type === "status") {
          setProcessingStatus(progressData.status || "");
          setUploadMessage(progressData.message || "");
        }

        if (progressData.type === "upload_progress") {
          setUploadProgress(progressData.progress || 0);
          setUploadMessage(progressData.message || "Uploading video...");
        }
      }
    )
      .then((result) => {
        setSilenceSegments(result.segments);
        setAudioUrl(result.audioUrl);

        if (result.uploadInfo) {
          setUploadInfo(result.uploadInfo);
        }

        if (result.segments && result.segments.length > 0) {
          const totalSegmentDuration = result.segments.reduce(
            (acc, segment) => acc + (segment.end - segment.start),
            0
          );
          setTotalSegmentDuration(totalSegmentDuration);

          const lastSegment = result.segments[result.segments.length - 1];
          setOriginalDuration(lastSegment.end);
        }
        setIsLoading(false);
        setProcessingStatus("");
      })
      .catch((error) => {
        console.error("Error removing silence:", error);
        setError(
          error instanceof Error
            ? error.message
            : "An error occurred while processing the video"
        );
        setIsLoading(false);
        setProcessingStatus("");
      });
  };

  const handleApplyChanges = async () => {
    if (!videoFile) return;

    setIsDialogProcessing(true);
    setProcessingStatus("Processing with new parameters...");

    try {
      const result = await removeSilence(
        videoFile,
        {
          volumeThreshold: dialogControls.volumeThreshold,
          paddingDurationMs: 0,
          speechPaddingMs: dialogControls.speechPaddingMs,
          silencePaddingMs: dialogControls.silencePaddingMs,
        },
        (progressData) => {
          if (progressData.type === "status") {
            setProcessingStatus(progressData.status || "");
          }
        }
      );

      setSilenceSegments(result.segments);
      setAudioUrl(result.audioUrl);

      if (result.uploadInfo) {
        setUploadInfo(result.uploadInfo);
      }

      setVolumeThreshold(dialogControls.volumeThreshold);
      setPaddingDurationMs(0);
      setSpeechPaddingMs(dialogControls.speechPaddingMs);
      setSilencePaddingMs(dialogControls.silencePaddingMs);

      if (videoFileName && videoFilePath) {
        let filePath = videoFilePath;
        if (!filePath.includes("/videos/") && filePath.includes("localhost/")) {
          filePath = `file://localhost/videos/${encodeURIComponent(videoFileName)}`;
        }

        const xml = createXmlFromSegments(result.segments, {
          frameRate: 60,
          width: 2560,
          height: 1440,
          pixelAspectRatio: "square",
          fields: "none",
          sourceFilePath: filePath,
        });

        const xmlBlob = new Blob([xml], { type: "application/xml" });
        const xmlUrl = URL.createObjectURL(xmlBlob);
        const downloadLink = document.createElement("a");
        downloadLink.href = xmlUrl;
        downloadLink.download = `${videoFileName.replace(/\.[^/.]+$/, "")}_edited.xml`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(xmlUrl);
      }
    } catch (error) {
      console.error("Error reprocessing in dialog:", error);
    } finally {
      setIsDialogProcessing(false);
    }
  };

  const handleDialogControlChange = (key: keyof DialogControls, value: number) => {
    if (key === "paddingDurationMs") return;
    setDialogControls((prev) => ({ ...prev, [key]: value }));
  };

  const handleDialogOpen = () => {
    setDialogControls({
      volumeThreshold,
      paddingDurationMs,
      speechPaddingMs,
      silencePaddingMs,
    });
  };

  const handleDiscardTranscription = () => {
    setTranscribedSegments(null);
    setFilteredSegments(null); // Reset filtered segments
  };

  useEffect(() => {
    return () => {
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
      }
    };
  }, [videoSrc]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-background text-foreground font-sans neo-brutalism-container selection:bg-black selection:text-yellow-300">
      <style jsx global>
        {neoBrutalismStyles}
      </style>
      <h1 className="text-4xl font-bold mb-8 text-center border-b-4 border-black pb-2">
        Neobrutalist Video Silence Remover
      </h1>

      <div className="mx-auto max-w-[800px]">
        <UploadCard
          onChange={handleFileChange}
          videoSrc={videoSrc}
          videoRef={videoRef}
        />

        {videoFile && (
          <>
            <div className="relative">
              <SilenceRemovalCard
                videoFile={videoFile}
                isLoading={isLoading}
                error={error}
                silenceSegments={silenceSegments}
                audioUrl={audioUrl}
                dialogControls={dialogControls}
                isDialogProcessing={isDialogProcessing}
                transcribedSegments={transcribedSegments}
                isTranscribing={isTranscribing}
                transcriptionProgress={transcriptionProgress}
                transcriptionError={transcriptionError}
                selectedLanguage={selectedLanguage}
                supportedLanguages={supportedLanguages}
                onRemoveSilence={handleRemoveSilence}
                onApplyChanges={handleApplyChanges}
                onDialogControlChange={handleDialogControlChange}
                onTranscribe={handleTranscribe}
                onLanguageChange={setSelectedLanguage}
                onDiscardTranscription={handleDiscardTranscription}
                onDialogOpen={handleDialogOpen}
                filteredSegments={filteredSegments}
                progressButton={progressButton}
                uploadProgress={uploadProgress}
                uploadMessage={uploadMessage}
                processingStatus={processingStatus}
              />
            </div>
          </>
        )}

        {transcribedSegments && (
          <TranscriptionSection
            selectedLanguage={selectedLanguage}
            supportedLanguages={supportedLanguages}
            isTranscribing={isTranscribing}
            transcriptionProgress={transcriptionProgress}
            onLanguageChange={setSelectedLanguage}
            onTranscribe={handleTranscribe}
            transcribedSegments={transcribedSegments}
            onDiscardTranscription={handleDiscardTranscription}
            transcriptionError={transcriptionError}
            onFilterWithAI={handleFilterWithAI}
            isFiltering={isFiltering}
          />
        )}

        {filteringError && (
          <div className="mt-4 p-4 border-2 border-red-300 bg-red-50 rounded">
            <h3 className="text-sm font-bold text-red-700">
              AI Filtering Error
            </h3>
            <p className="text-red-600 text-sm mt-1">{filteringError}</p>
          </div>
        )}

        {/* Show SelectedSegmentsPlayer as soon as we have silenceSegments and audioUrl */}
        {audioUrl && (
          <SelectedSegmentsPlayer
            audioUrl={audioUrl}
            segments={filteredSegments || []}
            originalSegments={transcribedSegments || []}
            onUpdateSegments={handleUpdateFilteredSegments}
            model={filterModel}
            silenceSegments={silenceSegments || []}
            videoFileName={videoFileName || ""}
            videoFilePath={videoFilePath || ""}
          />
        )}

        <TranscriptionWarningDialog
          isOpen={showTranscriptionWarning}
          onClose={() => setShowTranscriptionWarning(false)}
          onConfirm={confirmTranscriptionRemoval}
        />

        {/* Add the transcription progress dialog */}
        {progressDialog}

        {error && (
          <ErrorDisplay
            message={error}
            instructions={installationInstructions}
          />
        )}
      </div>
    </main>
  );
}
