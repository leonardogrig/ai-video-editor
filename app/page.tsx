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
  importEditedTranscription,
  createNoiseThresholdRequest,
  readNoiseThresholdResponse,
  probeTranscriptionCache,
  saveTranscriptionCache,
} from "./services/videoService";
import { neoBrutalismStyles } from "./styles/neo-brutalism";
import { SelectedSegmentsPlayer } from "@/components/SelectedSegmentsPlayer";
import { TranscriptionProgressDialog } from "./components/TranscriptionProgressDialog";
import { TranscriptionProgressButton } from "./components/TranscriptionProgressButton";
import { createXmlFromSegments } from "@/lib/utils";

const DEFAULT_CONTROLS: DialogControls = {
  noiseThresholdDb: -44,
  removeSilencesLongerThanMs: 130,
  keepTalksLongerThanMs: 120,
  marginBeforeMs: 50,
  marginAfterMs: 50,
};

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

  const [activeParams, setActiveParams] = useState<SilenceRemovalParams>({
    ...DEFAULT_CONTROLS,
  });

  const [dialogControls, setDialogControls] = useState<DialogControls>({
    ...DEFAULT_CONTROLS,
  });
  const [isDialogProcessing, setIsDialogProcessing] = useState(false);
  const [isCreatingRequest, setIsCreatingRequest] = useState(false);
  const [isReadingResponse, setIsReadingResponse] = useState(false);
  const [aiExchangeStatus, setAiExchangeStatus] = useState<string | null>(null);
  const [aiExchangePath, setAiExchangePath] = useState<string | null>(null);
  const [aiExchangePrompt, setAiExchangePrompt] = useState<string | null>(null);
  const [cachedTranscriptionAvailable, setCachedTranscriptionAvailable] =
    useState<boolean>(false);

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
  const [transcriptionProvider, setTranscriptionProviderState] =
    useState<string>("groq");

  // Load persisted provider choice
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("transcriptionProvider");
    if (stored === "groq" || stored === "elevenlabs") {
      setTranscriptionProviderState(stored);
    }
  }, []);

  const setTranscriptionProvider = (providerId: string) => {
    setTranscriptionProviderState(providerId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("transcriptionProvider", providerId);
    }
  };

  const [totalSegmentDuration, setTotalSegmentDuration] = useState<number>(0);
  const [originalDuration, setOriginalDuration] = useState<number>(0);

  const [installationInstructions, setInstallationInstructions] =
    useState<InstallationInstructions | null>(null);

  const [filteredSegments, setFilteredSegments] = useState<
    SpeechSegment[] | null
  >(null);
  const [isImportingEdited, setIsImportingEdited] = useState<boolean>(false);
  const [importEditedStatus, setImportEditedStatus] = useState<string | null>(null);
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
      setTranscribedSegments(null);
      setCachedTranscriptionAvailable(false);

      probeTranscriptionCache(file.name, file.size)
        .then((probe) => {
          if (probe.status === "hit") {
            setCachedTranscriptionAvailable(true);
          }
        })
        .catch(() => {
          // cache probe is best-effort; ignore errors
        });

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

    if (videoFile) {
      try {
        const probe = await probeTranscriptionCache(videoFile.name, videoFile.size);
        if (probe.status === "hit" && probe.segments?.length) {
          setTranscribedSegments(probe.segments);
          setTranscriptionProgress("100%");
          setCachedTranscriptionAvailable(true);
          setIsTranscribing(false);
          return;
        }
      } catch (err) {
        console.warn("Transcription cache probe failed:", err);
      }
    }

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
        uploadInfo || undefined,
        transcriptionProvider
      );

      const typedResult = result as { segments?: SpeechSegment[] };

      if (typedResult.segments) {
        setTranscribedSegments(typedResult.segments);
        if (videoFile) {
          saveTranscriptionCache({
            fileName: videoFile.name,
            fileSize: videoFile.size,
            language: selectedLanguage,
            segments: typedResult.segments,
          })
            .then(() => setCachedTranscriptionAvailable(true))
            .catch((err) =>
              console.warn("Failed to cache transcription:", err)
            );
        }
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

  const handleImportEdited = async () => {
    if (!transcribedSegments) return;

    setIsImportingEdited(true);
    setFilteringError(null);
    setImportEditedStatus(null);
    setFilterModel("claude-code:filter-transcription");

    try {
      const result = await importEditedTranscription();

      if (result.status === "missing") {
        setImportEditedStatus(
          "No edited.json found. Ask Claude Code to run the filter-transcription skill first."
        );
        return;
      }

      if (result.status === "invalid") {
        setFilteringError(`edited.json is invalid: ${result.error}`);
        return;
      }

      setFilteredSegments(result.segments);

      const original = result.originalCount ?? transcribedSegments.length;
      const removed = original - result.filteredCount;
      setImportEditedStatus(
        `Imported ${result.filteredCount} segments (removed ${removed} from ${original}).`
      );
    } catch (error) {
      console.error("Error importing edited transcription:", error);
      setFilteringError(
        error instanceof Error
          ? error.message
          : "An error occurred while importing edited.json"
      );
      setFilteredSegments(null);
    } finally {
      setIsImportingEdited(false);
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
        { ...activeParams },
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
      { ...activeParams },
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
        { ...dialogControls },
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

      setActiveParams({ ...dialogControls });

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
    setDialogControls((prev) => ({ ...prev, [key]: value }));
  };

  const handleDialogOpen = () => {
    setDialogControls({ ...activeParams });
  };

  const handleCreateThresholdRequest = async () => {
    if (!videoFile || isCreatingRequest) return;

    setIsCreatingRequest(true);
    setAiExchangeStatus("Writing request file…");
    setAiExchangePrompt(null);
    try {
      const { path, prompt } = await createNoiseThresholdRequest(
        uploadInfo ?? null,
        videoFile
      );
      setAiExchangePath(path);
      setAiExchangePrompt(prompt);
      setAiExchangeStatus(
        `Request written. Copy the prompt below into Claude Code, then click Set from Response.`
      );
    } catch (error) {
      console.error("Error creating noise threshold request:", error);
      setAiExchangeStatus(
        error instanceof Error ? error.message : "Failed to create request"
      );
    } finally {
      setIsCreatingRequest(false);
    }
  };

  const handleSetThresholdFromResponse = async () => {
    if (isReadingResponse) return;

    setIsReadingResponse(true);
    try {
      const result = await readNoiseThresholdResponse();
      setAiExchangePath(result.path);

      if (result.status === "missing") {
        setAiExchangePrompt(null);
        setAiExchangeStatus(
          "No request in flight. Click Create JSON first."
        );
      } else if (result.status === "pending") {
        setAiExchangeStatus(
          "Still waiting — noise_threshold_db is null. Ask Claude to fill it in."
        );
      } else if (result.status === "invalid") {
        setAiExchangeStatus(`File is invalid JSON: ${result.error}`);
      } else if (result.status === "ready") {
        const clamped = Math.max(-80, Math.min(0, Math.round(result.noise_threshold_db)));
        setDialogControls((prev) => ({ ...prev, noiseThresholdDb: clamped }));
        setAiExchangePrompt(null);
        const offsetNote =
          result.offset_applied
            ? ` (AI picked ${result.raw_value}, +${result.offset_applied} calibration → ${clamped})`
            : "";
        setAiExchangeStatus(
          `Threshold set to ${clamped} dB${offsetNote}. File consumed.`
        );
      }
    } catch (error) {
      console.error("Error reading noise threshold response:", error);
      setAiExchangeStatus(
        error instanceof Error ? error.message : "Failed to read response"
      );
    } finally {
      setIsReadingResponse(false);
    }
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
                isCreatingRequest={isCreatingRequest}
                isReadingResponse={isReadingResponse}
                aiExchangeStatus={aiExchangeStatus}
                aiExchangePath={aiExchangePath}
                aiExchangePrompt={aiExchangePrompt}
                cachedTranscriptionAvailable={cachedTranscriptionAvailable}
                transcribedSegments={transcribedSegments}
                isTranscribing={isTranscribing}
                transcriptionProgress={transcriptionProgress}
                transcriptionError={transcriptionError}
                selectedLanguage={selectedLanguage}
                supportedLanguages={supportedLanguages}
                transcriptionProvider={transcriptionProvider}
                onRemoveSilence={handleRemoveSilence}
                onApplyChanges={handleApplyChanges}
                onDialogControlChange={handleDialogControlChange}
                onTranscribe={handleTranscribe}
                onLanguageChange={setSelectedLanguage}
                onProviderChange={setTranscriptionProvider}
                onDiscardTranscription={handleDiscardTranscription}
                onDialogOpen={handleDialogOpen}
                onCreateThresholdRequest={handleCreateThresholdRequest}
                onSetThresholdFromResponse={handleSetThresholdFromResponse}
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
            onImportEdited={handleImportEdited}
            isImporting={isImportingEdited}
            importStatus={importEditedStatus}
          />
        )}

        {filteringError && (
          <div className="mt-4 p-4 border-2 border-red-300 bg-red-50 rounded">
            <h3 className="text-sm font-bold text-red-700">
              Import Error
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
            videoFile={videoFile}
            uploadInfo={uploadInfo}
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
