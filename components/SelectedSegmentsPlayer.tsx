"use client";

import React, { useState, useRef } from "react";
import { SpeechSegment } from "./types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { AudioPlayer, AudioPlayerHandle } from "./ui/AudioPlayer";
import { Input } from "./ui/input";
import { XmlSettingsDialog } from "./XmlSettingsDialog";
import { CaptionInstructions } from "./CaptionInstructionsBlock";
import { formatTime } from "../lib/utils";
import { downloadSrt, downloadXml, downloadJson, getBaseFilename } from "../lib/exportUtils";

// Use SpeechSegment as TranscribedSegment type alias
type TranscribedSegment = SpeechSegment;

interface SelectedSegmentsPlayerProps {
  audioUrl: string;
  segments: TranscribedSegment[];
  originalSegments: TranscribedSegment[];
  onUpdateSegments: (updatedSegments: TranscribedSegment[]) => void;
  model?: string;
  silenceSegments?: TranscribedSegment[];
  videoFileName?: string;
  videoFilePath?: string;
}

export function SelectedSegmentsPlayer({
  audioUrl,
  segments,
  originalSegments,
  onUpdateSegments,
  model,
  silenceSegments = [],
  videoFileName,
  videoFilePath
}: SelectedSegmentsPlayerProps) {
  const [editingSegment, setEditingSegment] = useState<{
    index: number;
    isSelected: boolean;
    segment: TranscribedSegment;
  } | null>(null);
  const [activeSegment, setActiveSegment] = useState<TranscribedSegment | null>(null);
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);

  // Check if a segment exists in the segments array
  const isSegmentSelected = (segment: TranscribedSegment): boolean => {
    return segments.some(
      (s) => 
        s.text === segment.text &&
        Math.abs(s.start - segment.start) < 0.1 &&
        Math.abs(s.end - segment.end) < 0.1
    );
  };

  // Toggle a segment between selected and unselected
  const toggleSegment = (segment: TranscribedSegment) => {
    if (isSegmentSelected(segment)) {
      // Remove from selected segments
      const newSelected = segments.filter(
        (s) => 
          !(s.text === segment.text &&
          Math.abs(s.start - segment.start) < 0.1 &&
          Math.abs(s.end - segment.end) < 0.1)
      );
      onUpdateSegments(newSelected);
    } else {
      // Add to selected segments
      onUpdateSegments([...segments, segment]);
    }
  };

  // Start editing a segment's timing
  const startEditing = (segment: TranscribedSegment, isSelected: boolean) => {
    const indexInArray = isSelected
      ? segments.findIndex(
          (s) => 
            s.text === segment.text &&
            Math.abs(s.start - segment.start) < 0.1 &&
            Math.abs(s.end - segment.end) < 0.1
        )
      : originalSegments.findIndex(
          (s) => 
            s.text === segment.text &&
            Math.abs(s.start - segment.start) < 0.1 &&
            Math.abs(s.end - segment.end) < 0.1
        );
    
    if (indexInArray !== -1) {
      setEditingSegment({
        index: indexInArray,
        isSelected,
        segment: { ...segment }
      });
    }
  };

  // Save edited segment
  const saveEditedSegment = () => {
    if (!editingSegment) return;
    
    const { index, isSelected, segment } = editingSegment;
    
    if (isSelected) {
      // Update in selected segments
      const updatedSegments = [...segments];
      updatedSegments[index] = segment;
      onUpdateSegments(updatedSegments);
    } else {
      // If editing an unselected segment, add it to selected
      if (!isSegmentSelected(segment)) {
        onUpdateSegments([...segments, segment]);
      }
    }
    
    setEditingSegment(null);
  };

  // Jump to timestamp in audio player without playing
  const highlightSegment = (segment: TranscribedSegment) => {
    if (audioPlayerRef.current) {
      // First jump to the start time
      audioPlayerRef.current.jumpToTime(segment.start);
      
      // If the AudioPlayer has a highlightTimeRange method, call it
      if (audioPlayerRef.current.highlightTimeRange) {
        audioPlayerRef.current.highlightTimeRange(segment.start, segment.end);
      }

      // Set the active segment
      setActiveSegment(segment);
    }
  };

  // Filter out unsuccessful transcriptions (segments with error or without text)
  const validOriginalSegments = originalSegments.filter(
    segment => !segment.error && segment.text
  );
  
  // Make a clean version of silence segments without text properties
  const cleanSilenceSegments = silenceSegments.map(segment => ({
    start: segment.start,
    end: segment.end,
    confidence: segment.confidence
  }));

  // Sort all segments by start time for consistent ordering
  const allSegmentsSorted = [...validOriginalSegments].sort((a, b) => a.start - b.start);
  const sortedSelectedSegments = [...segments].sort((a, b) => a.start - b.start);
  const sortedSilenceSegments = [...cleanSilenceSegments].sort((a, b) => a.start - b.start);

  // Get base filename for exports
  const baseFilename = getBaseFilename(audioUrl);


  return (
    <>
      {segments.length > 0 && (
        <div className="flex flex-col gap-4 p-4 border-2 border-black bg-white neo-brutalism-card mt-4 w-full">
          <h3 className="text-md font-bold border-b-2 border-black pb-2">
            Audio Player & Transcriptions
          </h3>
          
          {/* Display model information if available */}
          {model && (
            <div className="text-xs bg-blue-50 p-2 border border-blue-200 rounded mb-2">
              Filtered using: <span className="font-mono">{model.split('/').pop()}</span>
            </div>
          )}

          {/* Audio Player Component */}
          <AudioPlayer 
            ref={audioPlayerRef}
            audioUrl={audioUrl}
            speechSegments={segments.length > 0 ? segments : validOriginalSegments}
            showTranscriptions={false} // Hide default transcriptions, we'll use our custom list
            highlightSpeech={true} // Highlight speech segments in blue instead of silences in red
          />

          {/* Segment editing dialog */}
          {editingSegment && (
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white p-4 rounded-lg max-w-md w-full neo-brutalism-card border-2 border-black">
                <h4 className="font-bold mb-3">Edit Segment Timing</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm block mb-1">Start Time (seconds)</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={editingSegment.segment.start}
                      onChange={(e) => setEditingSegment({
                        ...editingSegment,
                        segment: { ...editingSegment.segment, start: parseFloat(e.target.value) }
                      })}
                      className="neo-brutalism-input w-full"
                    />
                  </div>
                  <div>
                    <label className="text-sm block mb-1">End Time (seconds)</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={editingSegment.segment.end}
                      onChange={(e) => setEditingSegment({
                        ...editingSegment,
                        segment: { ...editingSegment.segment, end: parseFloat(e.target.value) }
                      })}
                      className="neo-brutalism-input w-full"
                    />
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button
                      onClick={() => setEditingSegment(null)}
                      className="neo-brutalism-button bg-gray-200 hover:bg-gray-300"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={saveEditedSegment}
                      className="neo-brutalism-button bg-green-600 hover:bg-green-700 text-white"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Show transcription list only if we have transcribed segments */}
          {validOriginalSegments.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-bold mb-2">Transcription Segments</h4>
              <p className="text-xs text-gray-600 mb-2">
                Blue segments are selected for export. Click on a segment to highlight it in the player. Use buttons to select/deselect.
              </p>
              
              <div className="overflow-y-auto max-h-64 border border-gray-200 rounded-md">
                {validOriginalSegments.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">No transcribed segments available.</p>
                ) : (
                  <ul className="divide-y divide-gray-200">
                    {allSegmentsSorted.map((segment, index) => {
                      const isSelected = isSegmentSelected(segment);
                      const isActive = activeSegment && 
                        Math.abs(activeSegment.start - segment.start) < 0.1 && 
                        Math.abs(activeSegment.end - segment.end) < 0.1;
                      
                      return (
                        <li
                          key={index}
                          className={`p-3 text-sm transition-colors duration-200 ${
                            isActive 
                              ? "bg-yellow-100 border-b-2 border-yellow-200 hover:bg-yellow-200" 
                              : isSelected 
                                ? "bg-blue-100 border-b-2 border-blue-200 hover:bg-blue-200" 
                                : "bg-gray-50"
                          }`}
                        >
                          <div className="flex flex-wrap items-start gap-1">
                            <div className="flex-grow cursor-pointer" onClick={() => highlightSegment(segment)}>
                              <div className="flex justify-between mb-1">
                                <span className="font-mono text-xs text-gray-500">
                                  {formatTime(segment.start)} - {formatTime(segment.end)}
                                </span>
                                {segment.confidence && (
                                  <span className="text-xs px-1 rounded bg-blue-100 text-blue-700">
                                    {Math.round(segment.confidence * 100)}%
                                  </span>
                                )}
                              </div>
                              <p className="text-sm">{segment.text}</p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button
                                onClick={() => startEditing(segment, isSelected)}
                                className="neo-brutalism-button px-2 py-0.5 h-7 text-xs bg-blue-500 hover:bg-blue-600 text-white"
                              >
                                Edit
                              </Button>
                              <Button
                                onClick={() => toggleSegment(segment)}
                                className={`neo-brutalism-button px-2 py-0.5 h-7 text-xs ${
                                  isSelected
                                    ? "bg-red-500 hover:bg-red-600 text-white"
                                    : "bg-green-500 hover:bg-green-600 text-white"
                                }`}
                              >
                                {isSelected ? "Remove" : "Add"}
                              </Button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Standalone JSON Data Button and Dialog - Always visible if any data exists */}
      {(silenceSegments.length > 0 || validOriginalSegments.length > 0 || segments.length > 0) && (
        <div className="mt-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button className="neo-brutalism-button bg-gray-200 hover:bg-gray-300">
                View JSON Data
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh]">
              <DialogTitle className="mb-2">Segment Data</DialogTitle>
              <Tabs defaultValue={silenceSegments.length > 0 ? "silence" : originalSegments.length > 0 ? "original" : "selected"}>
                <TabsList className="w-full">
                  <TabsTrigger 
                    value="silence"
                    disabled={silenceSegments.length === 0}
                    className={silenceSegments.length === 0 ? "opacity-50 cursor-not-allowed" : ""}
                  >
                    Silence Removal
                  </TabsTrigger>
                  <TabsTrigger 
                    value="original"
                    disabled={validOriginalSegments.length === 0}
                    className={validOriginalSegments.length === 0 ? "opacity-50 cursor-not-allowed" : ""}
                  >
                    Transcribed Segments
                  </TabsTrigger>
                  <TabsTrigger 
                    value="selected" 
                    disabled={segments.length === 0}
                    className={segments.length === 0 ? "opacity-50 cursor-not-allowed" : ""}
                  >
                    AI Filtered Segments
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="silence" className="mt-4 h-[60vh]">
                  {silenceSegments.length > 0 ? (
                    <div className="flex flex-col h-full">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm">{silenceSegments.length} silence removal segments</span>
                        <div className="flex gap-2">
                          <XmlSettingsDialog 
                            segments={sortedSilenceSegments} 
                            filenamePrefix={`${baseFilename}_silence_removal`} 
                            onExport={downloadXml}
                            videoFileName={videoFileName}
                            videoFilePath={videoFilePath}
                          />
                          <Button 
                            onClick={() => downloadSrt(sortedSilenceSegments, `${baseFilename}_silence_removal.srt`)}
                            className="neo-brutalism-button text-xs bg-green-500 hover:bg-green-600 text-white"
                          >
                            Download SRT
                          </Button>
                          <Button 
                            onClick={() => downloadJson(sortedSilenceSegments, `${baseFilename}_silence_removal.json`)}
                            className="neo-brutalism-button text-xs bg-blue-500 hover:bg-blue-600 text-white"
                          >
                            Download JSON
                          </Button>
                        </div>
                      </div>
                      
                      {/* Caption Usage Instructions */}
                      <CaptionInstructions />
                      
                      <div className="overflow-auto flex-grow bg-gray-50 rounded border border-gray-200">
                        <pre className="p-4 text-xs whitespace-pre-wrap">
                          {JSON.stringify(sortedSilenceSegments, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-gray-500">
                      No silence removal segments available yet. Process a video to generate them.
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="original" className="mt-4 h-[60vh]">
                  {validOriginalSegments.length > 0 ? (
                    <div className="flex flex-col h-full">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm">{validOriginalSegments.length} valid transcribed segments</span>
                        <div className="flex gap-2">
                          <XmlSettingsDialog 
                            segments={allSegmentsSorted} 
                            filenamePrefix={`${baseFilename}_transcription`} 
                            onExport={downloadXml}
                            videoFileName={videoFileName}
                            videoFilePath={videoFilePath}
                          />
                          <Button 
                            onClick={() => downloadSrt(allSegmentsSorted, `${baseFilename}_transcription.srt`)}
                            className="neo-brutalism-button text-xs bg-green-500 hover:bg-green-600 text-white"
                          >
                            Download SRT
                          </Button>
                          <Button 
                            onClick={() => downloadJson(allSegmentsSorted, `${baseFilename}_transcription.json`)}
                            className="neo-brutalism-button text-xs bg-blue-500 hover:bg-blue-600 text-white"
                          >
                            Download JSON
                          </Button>
                        </div>
                      </div>
                      
                      {/* Caption Usage Instructions */}
                      <CaptionInstructions />
                      
                      <div className="overflow-auto flex-grow bg-gray-50 rounded border border-gray-200">
                        <pre className="p-4 text-xs whitespace-pre-wrap">
                          {JSON.stringify(allSegmentsSorted, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-gray-500">
                      No transcribed segments available yet. Transcribe the audio to generate them.
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="selected" className="mt-4 h-[60vh]">
                  {segments.length > 0 ? (
                    <div className="flex flex-col h-full">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm">{segments.length} filtered segments</span>
                        <div className="flex gap-2">
                          <XmlSettingsDialog 
                            segments={sortedSelectedSegments} 
                            filenamePrefix={`${baseFilename}_filtered`} 
                            onExport={downloadXml}
                            videoFileName={videoFileName}
                            videoFilePath={videoFilePath}
                          />
                          <Button 
                            onClick={() => downloadSrt(sortedSelectedSegments, `${baseFilename}_filtered.srt`)}
                            className="neo-brutalism-button text-xs bg-green-500 hover:bg-green-600 text-white"
                          >
                            Download SRT
                          </Button>
                          <Button 
                            onClick={() => downloadJson(sortedSelectedSegments, `${baseFilename}_filtered.json`)}
                            className="neo-brutalism-button text-xs bg-blue-500 hover:bg-blue-600 text-white"
                          >
                            Download JSON
                          </Button>
                        </div>
                      </div>
                      
                      {/* Caption Usage Instructions */}
                      <CaptionInstructions />
                      
                      <div className="overflow-auto flex-grow bg-gray-50 rounded border border-gray-200">
                        <pre className="p-4 text-xs whitespace-pre-wrap">
                          {JSON.stringify(sortedSelectedSegments, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-gray-500">
                      No AI filtered segments available yet. Apply AI filtering to generate them.
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
} 