import {
  SilenceRemovalParams,
  SilenceRemovalResult,
  SpeechSegment,
} from "@/components/types";

// Helper function to generate a unique session ID
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export interface UploadInfo {
  filePath: string;
  fileName: string;
  fileSize: number;
  sessionId: string;
}

// Helper function to upload a file in chunks
export async function uploadFileInChunks(
  file: File,
  onProgress?: (progress: number) => void
): Promise<UploadInfo> {
  const sessionId = generateSessionId();
  const chunkSize = 5 * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append("chunk", chunk);
    formData.append("chunkIndex", i.toString());
    formData.append("totalChunks", totalChunks.toString());
    formData.append("fileName", file.name);
    formData.append("fileSize", file.size.toString());
    formData.append("sessionId", sessionId);

    const response = await fetch("/api/upload-chunk", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Failed to upload chunk ${i}`);
    }

    const result = await response.json();

    if (result.status === "complete") {
      return {
        filePath: result.filePath,
        fileName: result.fileName,
        fileSize: result.fileSize,
        sessionId,
      };
    }

    if (onProgress && result.status === "progress") {
      onProgress(result.progress);
    }
  }

  throw new Error("Upload did not complete successfully");
}

export async function removeSilence(
  videoFile: File,
  params: SilenceRemovalParams,
  onProgress?: (progressData: any) => void
): Promise<
  SilenceRemovalResult & {
    uploadInfo?: {
      filePath: string;
      fileName: string;
      fileSize: number;
      sessionId: string;
    };
  }
> {
  try {
    if (videoFile.size > 200 * 1024 * 1024) {
      if (onProgress) {
        onProgress({
          type: "status",
          status: "uploading",
          message: "Starting file upload...",
        });
      }

      const uploadResult = await uploadFileInChunks(videoFile, (progress) => {
        if (onProgress) {
          onProgress({
            type: "upload_progress",
            progress,
            message: `Uploading video file: ${progress}%`,
          });
        }
      });

      if (onProgress) {
        onProgress({
          type: "status",
          status: "processing",
          message: "Upload complete. Processing video...",
        });
      }

      const response = await fetch("/api/process-chunked-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...uploadResult,
          noiseThresholdDb: params.noiseThresholdDb,
          removeSilencesLongerThanMs: params.removeSilencesLongerThanMs,
          keepTalksLongerThanMs: params.keepTalksLongerThanMs,
          marginBeforeMs: params.marginBeforeMs,
          marginAfterMs: params.marginAfterMs,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to process video";

        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = `${errorMessage}: ${response.statusText}`;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      return {
        ...data,
        uploadInfo: uploadResult,
      };
    }

    if (onProgress) {
      onProgress({
        type: "status",
        status: "uploading",
        message: "Uploading video file...",
      });
    }

    const formData = new FormData();
    formData.append("file", videoFile);
    formData.append("noiseThresholdDb", params.noiseThresholdDb.toString());
    formData.append(
      "removeSilencesLongerThanMs",
      params.removeSilencesLongerThanMs.toString()
    );
    formData.append(
      "keepTalksLongerThanMs",
      params.keepTalksLongerThanMs.toString()
    );
    formData.append("marginBeforeMs", params.marginBeforeMs.toString());
    formData.append("marginAfterMs", params.marginAfterMs.toString());

    if (onProgress) {
      onProgress({
        type: "status",
        status: "processing",
        message: "Processing video for silence detection...",
      });
    }

    const response = await fetch("/api/process-video", {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });

    if (!response.ok) {
      let errorMessage = "Failed to process video";

      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        errorMessage = `${errorMessage}: ${response.statusText}`;
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error in silence removal:", error);
    throw error;
  }
}

export async function transcribeVideo(
  videoFile: File,
  segments: any[],
  language: string,
  onProgress?: (progressData: any) => void,
  uploadInfo?: {
    filePath: string;
    fileName: string;
    fileSize: number;
    sessionId: string;
  },
  provider: string = "groq"
) {
  try {
    if (uploadInfo) {
      if (onProgress) {
        onProgress({
          type: "status",
          status: "transcribing",
          message: "Starting transcription with previously uploaded file...",
        });
      }

      const response = await fetch("/api/transcribe-chunked", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath: uploadInfo.filePath,
          fileName: uploadInfo.fileName,
          segments,
          language,
          provider,
        }),
      });

      if (
        !response.ok &&
        !response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        if (
          response.headers.get("Content-Type")?.includes("application/json")
        ) {
          const errorData = await response.json();
          throw new Error(
            errorData.error || "Failed to start chunked transcription process"
          );
        }
        throw new Error(`Server error: ${response.status}`);
      }

      return handleStreamingResponse(response, onProgress);
    } else if (videoFile.size > 200 * 1024 * 1024) {
      if (onProgress) {
        onProgress({
          type: "upload_start",
          message: "Starting chunked upload for transcription...",
        });
      }

      const uploadResult = await uploadFileInChunks(videoFile, (progress) => {
        if (onProgress) {
          onProgress({
            type: "upload_progress",
            progress,
            message: `Uploading video file: ${progress}%`,
          });
        }
      });

      if (onProgress) {
        onProgress({
          type: "upload_complete",
          message: "Upload complete. Starting transcription...",
        });
      }

      const response = await fetch("/api/transcribe-chunked", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath: uploadResult.filePath,
          fileName: videoFile.name,
          segments,
          language,
          provider,
        }),
      });

      if (
        !response.ok &&
        !response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        if (
          response.headers.get("Content-Type")?.includes("application/json")
        ) {
          const errorData = await response.json();
          throw new Error(
            errorData.error || "Failed to start chunked transcription process"
          );
        }
        throw new Error(`Server error: ${response.status}`);
      }

      return handleStreamingResponse(response, onProgress);
    } else {
      const formData = new FormData();
      formData.append("videoFile", videoFile);
      formData.append("segments", JSON.stringify(segments));
      formData.append("language", language);
      formData.append("provider", provider);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        throw new Error("Transcription request timed out after 30 minutes");
      }, 30 * 60 * 1000);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (
        !response.ok &&
        !response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        if (
          response.headers.get("Content-Type")?.includes("application/json")
        ) {
          const errorData = await response.json();
          throw new Error(
            errorData.error || "Failed to start transcription process"
          );
        }
        throw new Error(`Server error: ${response.status}`);
      }

      return handleStreamingResponse(response, onProgress);
    }
  } catch (error) {
    console.error("Transcription error:", error);
    throw error;
  }
}

// Helper function to handle streaming responses
async function handleStreamingResponse(
  response: Response,
  onProgress?: (progressData: any) => void
) {
  return new Promise((resolve, reject) => {
    // Make sure we have a body to read from
    if (!response.body) {
      reject(new Error("Response body is null"));
      return;
    }

    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: any = { segments: [] };

    function processText(text: string) {
      // Process all complete SSE messages in the buffer
      const messages = text.split("\n\n");

      // If the last chunk doesn't end with double newline, it's incomplete
      // Keep it in the buffer for the next iteration
      if (!text.endsWith("\n\n")) {
        buffer = messages.pop() || "";
      } else {
        buffer = "";
      }

      // Process each complete message
      for (const message of messages) {
        if (!message.trim()) continue;

        // Extract the JSON data from the "data:" prefix
        const dataMatch = message.match(/^data:(.*)/);
        if (!dataMatch) continue;

        try {
          const data = JSON.parse(dataMatch[1]);

          // Only call onProgress if it's provided
          if (onProgress) {
            onProgress(data);
          }

          // If this is the final message, store the result
          if (data.type === "complete") {
            finalResult = data;
          }

          // If there was an error, throw it
          if (data.type === "error") {
            throw new Error(
              data.message || "An error occurred during transcription"
            );
          }
        } catch (e) {
          console.error("Error parsing SSE message:", e);
        }
      }
    }

    function pump() {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            // Process any remaining text in the buffer
            if (buffer) {
              processText(buffer + "\n\n");
            }
            resolve(finalResult);
            return;
          }

          const chunk = decoder.decode(value, { stream: true });
          processText(buffer + chunk);

          // Continue reading
          pump();
        })
        .catch((error) => {
          reject(error);
        });
    }

    // Start the reading process
    pump();
  });
}

export async function createNoiseThresholdRequest(
  uploadInfo: {
    filePath: string;
    fileName: string;
    fileSize: number;
    sessionId: string;
  } | null,
  videoFile?: File | null
): Promise<{ path: string; prompt: string; stats?: any; summary?: string; mentalModel?: string }> {
  let body: BodyInit;
  let headers: HeadersInit = {};

  if (uploadInfo?.filePath) {
    body = JSON.stringify({
      filePath: uploadInfo.filePath,
      fileName: uploadInfo.fileName,
    });
    headers = { "Content-Type": "application/json" };
  } else if (videoFile) {
    const formData = new FormData();
    formData.append("file", videoFile);
    body = formData;
  } else {
    throw new Error("No video file available to create request");
  }

  const response = await fetch("/api/ai-exchange/noise-threshold", {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error || `Failed to create request (${response.status})`
    );
  }

  return await response.json();
}

export async function readNoiseThresholdResponse(): Promise<
  | { status: "missing"; path: string }
  | { status: "pending"; path: string }
  | {
      status: "ready";
      path: string;
      noise_threshold_db: number;
      raw_value: number;
      offset_applied: number;
    }
  | { status: "invalid"; path: string; error: string }
> {
  const response = await fetch("/api/ai-exchange/noise-threshold", {
    method: "GET",
  });

  const data = await response.json();
  if (!response.ok && data.status !== "invalid") {
    throw new Error(data.error || `Failed to read response (${response.status})`);
  }
  return data;
}

export async function probeTranscriptionCache(
  fileName: string,
  fileSize?: number
): Promise<
  | { status: "missing"; path: string }
  | { status: "invalid"; path: string; error: string }
  | {
      status: "size-mismatch";
      path: string;
      cachedSize: number;
      actualSize: number;
    }
  | {
      status: "hit";
      path: string;
      fileName: string;
      fileSize: number | null;
      language: string | null;
      segments: SpeechSegment[];
      createdAt: string;
    }
> {
  const params = new URLSearchParams({ fileName });
  if (typeof fileSize === "number") params.set("fileSize", String(fileSize));
  const response = await fetch(`/api/transcription-cache?${params.toString()}`);
  return response.json();
}

export async function saveTranscriptionCache(data: {
  fileName: string;
  fileSize?: number;
  language: string;
  segments: SpeechSegment[];
}): Promise<{ ok: boolean; path: string; error?: string }> {
  const response = await fetch("/api/transcription-cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function getRawTranscriptionPath(): Promise<
  | { status: "missing"; dir: string }
  | { status: "ambiguous"; dir: string; candidates: string[] }
  | { status: "ready"; path: string; fileName: string }
> {
  const response = await fetch("/api/transcription-raw-path");
  return response.json();
}

export async function renderFinalVideo(
  videoFile: File | null,
  uploadInfo: UploadInfo | null,
  onProgress?: (progressData: {
    type: "upload_progress" | "status";
    progress?: number;
    message?: string;
  }) => void
): Promise<{ blob: Blob; fileName: string }> {
  let effectiveUpload = uploadInfo;

  if (!effectiveUpload) {
    if (!videoFile) {
      throw new Error("No video file available to render");
    }
    onProgress?.({
      type: "status",
      message: "Uploading video for rendering...",
    });
    effectiveUpload = await uploadFileInChunks(videoFile, (progress) => {
      onProgress?.({
        type: "upload_progress",
        progress,
        message: `Uploading video for rendering: ${progress}%`,
      });
    });
  }

  onProgress?.({
    type: "status",
    message: "Rendering final video with ffmpeg...",
  });

  const response = await fetch("/api/render-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath: effectiveUpload.filePath,
      fileName: effectiveUpload.fileName,
    }),
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });

  if (!response.ok) {
    let msg = `Failed to render video (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }

  const blob = await response.blob();

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const base = effectiveUpload.fileName.replace(/\.[^/.]+$/, "");
  const fileName = match?.[1] ?? `${base}_edited.mp4`;

  return { blob, fileName };
}

export async function importEditedTranscription(): Promise<
  | { status: "missing"; path: string }
  | { status: "invalid"; path: string; error: string }
  | {
      status: "ready";
      path: string;
      segments: SpeechSegment[];
      originalCount: number | null;
      filteredCount: number;
      createdAt: string | null;
    }
> {
  const response = await fetch("/api/import-edited-transcription", {
    method: "GET",
  });
  const data = await response.json();
  if (!response.ok && data.status !== "invalid" && data.status !== "missing") {
    throw new Error(data.error || `Failed to import edited transcription (${response.status})`);
  }
  return data;
}

