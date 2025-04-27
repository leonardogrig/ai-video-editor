import React, { useState, useEffect, MouseEvent } from 'react';
import { SpeechSegment } from '@/components/types';

type TranscriptionProgressDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  currentSegment: number;
  totalSegments: number;
  status: string;
  message: string;
  currentSegmentInfo?: {
    start: string;
    end: string;
    duration: string;
  };
  result?: string;
  completedSegments?: Array<{
    segment: SpeechSegment;
    result: string;
  }>;
};

export function TranscriptionProgressDialog({
  isOpen,
  onClose,
  currentSegment,
  totalSegments,
  status,
  message,
  currentSegmentInfo,
  result,
  completedSegments = []
}: TranscriptionProgressDialogProps) {
  // Track highest seen progress to prevent going backwards
  const [smoothProgress, setSmoothProgress] = useState(0);
  const rawPercent = totalSegments > 0 ? Math.round((currentSegment / totalSegments) * 100) : 0;
  
  // Ensure progress never decreases
  useEffect(() => {
    if (rawPercent > smoothProgress) {
      setSmoothProgress(rawPercent);
    }
  }, [rawPercent, smoothProgress]);
  
  // Use the smooth progress value for display
  const percent = smoothProgress;
  
  // Reset smooth progress when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSmoothProgress(rawPercent);
    }
  }, [isOpen, rawPercent]);
  
  // Handle click outside the dialog content
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };
  
  // Get badge color based on status
  const getBadgeColor = () => {
    switch (status) {
      case 'transcribing': return 'bg-green-300';
      case 'extracting': return 'bg-blue-300';
      case 'filtering': return 'bg-yellow-300';
      case 'saving': return 'bg-purple-300';
      case 'checking': return 'bg-orange-300';
      case 'completed_segment': return 'bg-teal-300';
      default: return 'bg-gray-300';
    }
  };

  // Format time to show minutes and seconds
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  if (!isOpen) return null;
  
  return (
    <div 
      className="fixed inset-0 flex items-center justify-center z-50 backdrop-blur-sm bg-black/30 p-4"
      onClick={handleBackdropClick}
    >
      <div className="max-w-2xl w-full neo-brutalism-card p-5 border-4 border-black shadow-brutal bg-yellow-100 max-h-[90vh] overflow-auto relative">
        {/* Close button */}
        <button 
          onClick={onClose}
          className="absolute top-3 right-3 w-10 h-10 border-4 border-black bg-red-400 hover:bg-red-500 flex items-center justify-center transform rotate-2 shadow-brutal-sm"
        >
          <span className="text-xl font-bold">×</span>
        </button>
        
        <div className="flex flex-col mb-12">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-2xl font-bold transform -rotate-1">Transcription Progress</h3>
            <span className="mr-10  text-lg font-bold border-4 border-black px-3 py-1 transform rotate-2 bg-white">{percent}%</span>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full h-10 border-4 border-black bg-white relative overflow-hidden mb-3 shadow-brutal-sm">
            <div 
              className="h-full bg-pink-400 transition-all duration-700 ease-out flex items-center justify-end pr-2"
              style={{ width: `${percent}%` }}
            >
              {percent > 15 && (
                <span className="font-bold text-black">
                  {currentSegment}/{totalSegments}
                </span>
              )}
            </div>
          </div>
          
          {/* Status badge */}
          <div className="flex items-center mb-3">
            <div className={`inline-block px-3 py-1 border-4 border-black ${getBadgeColor()} font-bold mr-3 transform -rotate-2 shadow-brutal-sm`}>
              {status === 'transcribing' ? 'TRANSCRIBING' : 
              status === 'extracting' ? 'EXTRACTING' : 
              status === 'filtering' ? 'FILTERING' : 
              status === 'saving' ? 'SAVING' : 
              status === 'checking' ? 'CHECKING' : 
              status === 'completed_segment' ? 'COMPLETED' : 'PROCESSING'}
            </div>
            <p className="text-black font-medium border-b-2 border-black">{message}</p>
          </div>
          
          {/* Current segment info */}
          {currentSegmentInfo && (
            <div className="mt-2 p-3 border-4 border-black bg-white transform rotate-1 shadow-brutal-sm">
              <h4 className="font-bold mb-1 text-sm border-b-2 border-black pb-1">Current Segment Info:</h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="font-bold">Start:</span> {currentSegmentInfo.start}s
                </div>
                <div>
                  <span className="font-bold">End:</span> {currentSegmentInfo.end}s
                </div>
                <div>
                  <span className="font-bold">Duration:</span> {currentSegmentInfo.duration}s
                </div>
              </div>
            </div>
          )}
          
          {/* List of completed transcriptions */}
          {completedSegments.length > 0 && (
            <div className="mt-4">
              <h4 className="font-bold text-sm border-b-2 border-black pb-1 mb-2">Completed Transcriptions:</h4>
              <div className="max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                {completedSegments.map((item, index) => {
                  const rotate = index % 2 === 0 ? -1 : 1;
                  return (
                    <div 
                      key={index} 
                      className="mb-3 p-3 border-4 border-black bg-blue-100 shadow-brutal-sm segment-card transition-all duration-200"
                      style={{ 
                        transform: `rotate(${rotate}deg)`,
                        marginLeft: index % 2 === 0 ? '0px' : '10px' 
                      }}
                    >
                      <div className="flex justify-between text-xs font-bold mb-1 border-b border-black pb-1">
                        <span>Segment {index + 1}</span>
                        <span>{formatTime(item.segment.start)} - {formatTime(item.segment.end)}</span>
                      </div>
                      <p className="text-sm">{item.result}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Tips for the user */}
          {completedSegments.length === 0 && (
            <div className="mt-4 p-2 bg-white border-4 border-black transform rotate-1 shadow-brutal-sm">
              <p className="text-xs font-medium">
                <span className="font-bold">Pro tip:</span> Transcription is processing your segments in parallel. Results will appear here as they complete.
              </p>
            </div>
          )}
        </div>

        <style jsx>{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 10px;
          }
          
          .custom-scrollbar::-webkit-scrollbar-track {
            background: white;
            border: 2px solid black;
          }
          
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: black;
            border: 2px solid white;
          }
          
          .segment-card:hover {
            box-shadow: 0 6px 0 0 rgba(0, 0, 0, 1);
            translate: 0 -2px;
          }
        `}</style>
      </div>
    </div>
  );
} 