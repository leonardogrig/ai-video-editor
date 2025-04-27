"use client";

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Button } from "./button";

interface AudioPlayerProps {
  audioUrl: string;
  speechSegments: {
    start: number;
    end: number;
    text?: string;
    error?: string;
    skipped?: boolean;
  }[];
  showTranscriptions?: boolean;
  highlightSpeech?: boolean;
}

// Export the player's handle type for typescript support
export interface AudioPlayerHandle {
  jumpToTime: (time: number) => void;
  play: () => void;
  pause: () => void;
  highlightTimeRange: (startTime: number, endTime: number) => void;
}

// Convert to forwardRef pattern
export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ audioUrl, speechSegments, showTranscriptions = true, highlightSpeech = false }, ref) {
    const [currentSegment, setCurrentSegment] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isVisualizing, setIsVisualizing] = useState(true);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [audioData, setAudioData] = useState<Float32Array | null>(null);
    const [audioDuration, setAudioDuration] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(true);
    const [waveformScale, setWaveformScale] = useState<number>(2.5);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isSkipping, setIsSkipping] = useState<boolean>(false);
    
    // New state variables for horizontal zoom and scroll
    const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = show max 60 seconds, higher numbers = more zoomed in
    const [viewportStartTime, setViewportStartTime] = useState<number>(0); // Time in seconds where the viewport starts
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStartX, setDragStartX] = useState<number>(0);
    const [dragStartTime, setDragStartTime] = useState<number>(0);
    
    // Add highlight range state
    const [highlightRange, setHighlightRange] = useState<{start: number, end: number} | null>(null);

    // Expose functions via ref
    useImperativeHandle(ref, () => ({
      jumpToTime: (time: number) => {
        if (audioRef.current) {
          audioRef.current.currentTime = time;
          setCurrentTime(time);
          
          // Make sure the time is visible
          if (time < viewportStartTime || time > getViewportEndTime()) {
            // Center the time in the viewport
            const halfViewport = getViewportDuration() / 2;
            let newStartTime = time - halfViewport;
            
            // Keep in bounds
            newStartTime = Math.max(0, Math.min(newStartTime, getMaxViewportStartTime()));
            
            setViewportStartTime(newStartTime);
          }
        }
      },
      play: () => {
        if (audioRef.current && audioRef.current.paused) {
          audioRef.current.play().catch(e => console.error("Error playing audio:", e));
        }
      },
      pause: () => {
        if (audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
        }
      },
      highlightTimeRange: (startTime: number, endTime: number) => {
        setHighlightRange({ start: startTime, end: endTime });
        
        // Make sure the range is visible in the viewport
        const rangeCenter = (startTime + endTime) / 2;
        const rangeWidth = endTime - startTime;
        const viewportDuration = getViewportDuration();
        
        // Only adjust viewport if the range doesn't fit or is partially outside
        if (rangeWidth > viewportDuration || 
            startTime < viewportStartTime || 
            endTime > getViewportEndTime()) {
          
          // Try to center the range in the viewport
          let newStartTime = rangeCenter - (viewportDuration / 2);
          
          // If the range is wider than viewport, adjust zoom to fit it
          if (rangeWidth > viewportDuration) {
            // Calculate new zoom level to fit the range with some padding
            const newZoomLevel = 60 / (rangeWidth * 1.5);
            setZoomLevel(newZoomLevel);
            
            // Recalculate the start time with the new zoom level
            const newViewportDuration = 60 / newZoomLevel;
            newStartTime = rangeCenter - (newViewportDuration / 2);
          }
          
          // Keep in bounds
          newStartTime = Math.max(0, Math.min(newStartTime, getMaxViewportStartTime()));
          setViewportStartTime(newStartTime);
        }
      }
    }));

    // Calculate viewport properties based on zoom level
    const getViewportDuration = () => Math.min(audioDuration, 60 / zoomLevel);
    const getViewportEndTime = () => Math.min(audioDuration, viewportStartTime + getViewportDuration());

    // Maximum viewport start time based on zoom level
    const getMaxViewportStartTime = () => Math.max(0, audioDuration - getViewportDuration());

    // Ensure viewport stays within bounds when zoom changes
    useEffect(() => {
      if (audioDuration > 0) {
        // Adjust viewport if needed to keep it within bounds
        const maxStart = getMaxViewportStartTime();
        if (viewportStartTime > maxStart) {
          setViewportStartTime(maxStart);
        }
      }
    }, [zoomLevel, audioDuration]);

    // Auto-scroll to follow playback when needed
    useEffect(() => {
      // Only auto-scroll when actively playing and not manually dragging
      if (!isDragging && isPlaying) {
        // If current playback position is outside viewport, scroll to follow it
        if (currentTime >= getViewportEndTime() || currentTime < viewportStartTime) {
          // If playing and current time is outside viewport, advance the viewport
          const newStartTime = Math.min(getMaxViewportStartTime(), currentTime - getViewportDuration() * 0.1);
          setViewportStartTime(newStartTime);
        }
        
        // If current segment is outside the viewport, scroll to it
        if (currentSegment >= 0 && currentSegment < speechSegments.length) {
          const segmentStart = speechSegments[currentSegment].start;
          const segmentEnd = speechSegments[currentSegment].end;
          
          if (segmentStart < viewportStartTime || segmentEnd > getViewportEndTime()) {
            // Center the segment in the viewport if possible
            const segmentCenter = (segmentStart + segmentEnd) / 2;
            const halfViewport = getViewportDuration() / 2;
            let newStartTime = segmentCenter - halfViewport;
            
            // Keep in bounds
            newStartTime = Math.max(0, Math.min(newStartTime, getMaxViewportStartTime()));
            
            setViewportStartTime(newStartTime);
          }
        }
      }
    }, [currentTime, isPlaying, isDragging, currentSegment, speechSegments]);

    // Fetch and decode audio data for waveform
    useEffect(() => {
      if (!audioUrl) return;

      setLoading(true);

      const fetchAudio = async () => {
        try {
          const response = await fetch(audioUrl);
          if (!response.ok) {
            throw new Error("Failed to load audio file");
          }

          const arrayBuffer = await response.arrayBuffer();
          const audioContext = new (window.AudioContext ||
            (window as any).webkitAudioContext)();

          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          setAudioDuration(audioBuffer.duration);

          // Get audio data from the left channel
          const channelData = audioBuffer.getChannelData(0);
          setAudioData(channelData);
          setLoading(false);

          // Clean up
          audioContext.close();
        } catch (error) {
          console.error("Error loading audio data:", error);
          setLoading(false);
        }
      };

      fetchAudio();
    }, [audioUrl]);

    // Draw waveform visualization with horizontal zoom and scroll
    useEffect(() => {
      if (
        !canvasRef.current ||
        !audioData ||
        !audioDuration ||
        speechSegments.length === 0
      )
        return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Fill background
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Calculate visible time range and scaling factors
      const viewportDuration = getViewportDuration();
      const viewportEndTime = getViewportEndTime();
      
      // Function to convert time to X position
      const timeToX = (time: number) => {
        return ((time - viewportStartTime) / viewportDuration) * canvas.width;
      };

      if (highlightSpeech) {
        // For highlighting speech segments in blue
        ctx.fillStyle = "rgba(59, 130, 246, 0.2)"; // bg-blue-100 equivalent
        
        // Sort segments by start time
        const sortedSegments = [...speechSegments].sort((a, b) => a.start - b.start);
        
        // Draw speech segments
        sortedSegments.forEach(segment => {
          const segmentStart = Math.max(segment.start, viewportStartTime);
          const segmentEnd = Math.min(segment.end, viewportEndTime);
          
          if (segmentEnd > segmentStart) {
            const x1 = timeToX(segmentStart);
            const x2 = timeToX(segmentEnd);
            ctx.fillRect(x1, 0, x2 - x1, canvas.height);
          }
        });
      } else {
        // Original behavior - Draw silence areas (inverse of speech segments)
        ctx.fillStyle = "rgba(255, 0, 0, 0.2)";

        // Find silence gaps between segments
        let lastEnd = 0;
        
        // Sort segments by start time to ensure correct silence detection
        const sortedSegments = [...speechSegments].sort((a, b) => a.start - b.start);
        
        // Draw silence areas between segments
        sortedSegments.forEach(segment => {
          // Draw silence from last segment end to this segment start (if there's a gap)
          if (segment.start > lastEnd) {
            const silenceStart = Math.max(lastEnd, viewportStartTime);
            const silenceEnd = Math.min(segment.start, viewportEndTime);
            
            if (silenceEnd > silenceStart) {
              const x1 = timeToX(silenceStart);
              const x2 = timeToX(silenceEnd);
              ctx.fillRect(x1, 0, x2 - x1, canvas.height);
            }
          }
          
          // Update lastEnd to the end of this segment
          lastEnd = Math.max(lastEnd, segment.end);
        });
        
        // Draw silence from last segment to end of audio (if there's a gap)
        if (lastEnd < audioDuration) {
          const silenceStart = Math.max(lastEnd, viewportStartTime);
          const silenceEnd = Math.min(audioDuration, viewportEndTime);
          
          if (silenceEnd > silenceStart) {
            const x1 = timeToX(silenceStart);
            const x2 = timeToX(silenceEnd);
            ctx.fillRect(x1, 0, x2 - x1, canvas.height);
          }
        }
      }

      // Draw highlighted time range if exists
      if (highlightRange) {
        const rangeStart = Math.max(highlightRange.start, viewportStartTime);
        const rangeEnd = Math.min(highlightRange.end, viewportEndTime);
        
        if (rangeEnd > rangeStart) {
          const x1 = timeToX(rangeStart);
          const x2 = timeToX(rangeEnd);
          
          // Draw the highlight with a semi-transparent overlay
          ctx.fillStyle = "rgba(0, 0, 255, 0.2)"; // Blue highlight
          ctx.fillRect(x1, 0, x2 - x1, canvas.height);
          
          // Draw the highlight borders
          ctx.strokeStyle = "rgba(0, 0, 255, 0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, 0);
          ctx.lineTo(x1, canvas.height);
          ctx.moveTo(x2, 0);
          ctx.lineTo(x2, canvas.height);
          ctx.stroke();
        }
      }

      // Draw playback position line if it's in the viewport
      if (audioRef.current && currentTime >= viewportStartTime && currentTime <= viewportEndTime) {
        const playbackX = timeToX(currentTime);
        ctx.beginPath();
        ctx.strokeStyle = "#ff0000";
        ctx.lineWidth = 2;
        ctx.moveTo(playbackX, 0);
        ctx.lineTo(playbackX, canvas.height);
        ctx.stroke();
      }

      // Draw the actual waveform with enhanced prominence
      const centerY = canvas.height / 2;
      
      // Calculate data range to display
      const startSample = Math.floor((audioData.length * viewportStartTime) / audioDuration);
      const endSample = Math.floor((audioData.length * viewportEndTime) / audioDuration);
      const samplesInView = endSample - startSample;
      const samplesPerPixel = Math.max(1, Math.floor(samplesInView / canvas.width));

      // Enhanced waveform rendering for visible portion
      for (let x = 0; x < canvas.width; x++) {
        const pixelStartSample = startSample + Math.floor(x * samplesInView / canvas.width);
        let min = 1.0;
        let max = -1.0;

        // Find min/max in this pixel's sample range
        for (let i = 0; i < samplesPerPixel; i++) {
          if (pixelStartSample + i < audioData.length) {
            const sample = audioData[pixelStartSample + i];
            if (sample < min) min = sample;
            if (sample > max) max = sample;
          }
        }

        // Draw the waveform
        const minY = min * waveformScale * centerY + centerY;
        const maxY = max * waveformScale * centerY + centerY;
        
        ctx.beginPath();
        ctx.strokeStyle = "#3498db";
        ctx.lineWidth = 1.5;
        ctx.moveTo(x, minY);
        ctx.lineTo(x, maxY);
        ctx.stroke();
      }

      // Draw time markers
      ctx.fillStyle = "#000000";
      ctx.font = "10px Arial";
      ctx.textAlign = "center";

      // Draw viewport time range on top
      ctx.fillStyle = "#000000";
      ctx.font = "11px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`Viewing: ${viewportStartTime.toFixed(1)}s - ${viewportEndTime.toFixed(1)}s`, 5, 15);
      
      // Draw time markers at regular intervals
      const markerInterval = Math.max(1, Math.ceil(viewportDuration / 10)); // Show max ~10 markers
      const firstMarker = Math.ceil(viewportStartTime / markerInterval) * markerInterval;
      
      for (let time = firstMarker; time <= viewportEndTime; time += markerInterval) {
        const x = timeToX(time);
        
        // Draw tick mark
        ctx.beginPath();
        ctx.strokeStyle = "#aaa";
        ctx.lineWidth = 1;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
        
        // Draw time label
        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.fillText(`${time.toFixed(1)}s`, x, canvas.height - 5);
      }
      
      // Draw zoom level indicator
      ctx.fillStyle = "#000000";
      ctx.textAlign = "right";
      ctx.fillText(`Zoom: ${zoomLevel.toFixed(1)}x`, canvas.width - 5, 15);
    }, [
      audioData,
      audioDuration,
      speechSegments,
      currentSegment,
      currentTime,
      waveformScale,
      zoomLevel,
      viewportStartTime,
      highlightSpeech,
    ]);

    // Skip to the next speech segment if we're at the end of the current one
    const skipToNextSegmentIfNeeded = (currentTime: number) => {
      if (isSkipping || !isPlaying || currentSegment >= speechSegments.length - 1) return;

      const currentSegmentData = speechSegments[currentSegment];
      
      // If we've reached the end of the current segment
      if (currentTime >= currentSegmentData.end - 0.05) {
        const nextSegmentIndex = currentSegment + 1;
        
        // If there is a next segment to skip to
        if (nextSegmentIndex < speechSegments.length) {
          setIsSkipping(true);
          setCurrentSegment(nextSegmentIndex);
          
          // Jump to the start of the next segment
          if (audioRef.current) {
            audioRef.current.currentTime = speechSegments[nextSegmentIndex].start;
            // Resume playback if we were playing
            if (isPlaying) {
              audioRef.current.play().catch(e => console.error("Error playing audio:", e));
            }
          }
          
          setTimeout(() => setIsSkipping(false), 50);
        }
      }
    };

    // Monitor audio time updates to track segments and handle skipping
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      
      const handleTimeUpdate = () => {
        const currentTime = audio.currentTime;
        setCurrentTime(currentTime);
        
        // Find which segment we're in
        let inAnySegment = false;
        for (let i = 0; i < speechSegments.length; i++) {
          const segment = speechSegments[i];
          if (currentTime >= segment.start && currentTime <= segment.end) {
            if (i !== currentSegment) {
              setCurrentSegment(i);
              console.log(`Now playing segment ${i + 1}: "${segment.text || '(No text)'}"`);
            }
            inAnySegment = true;
            return;
          }
        }
        
        // If not in any segment, we need to skip to the next appropriate segment
        if (!inAnySegment && !isSkipping && isPlaying) {
          // Find the next segment after current time
          let nextSegmentIndex = -1;
          for (let i = 0; i < speechSegments.length; i++) {
            if (speechSegments[i].start > currentTime) {
              nextSegmentIndex = i;
              break;
            }
          }
          
          if (nextSegmentIndex >= 0) {
            console.log(`Skipping silence to segment ${nextSegmentIndex + 1}`);
            setIsSkipping(true);
            setCurrentSegment(nextSegmentIndex);
            audio.currentTime = speechSegments[nextSegmentIndex].start;
            setTimeout(() => setIsSkipping(false), 50);
          } else if (currentTime >= audioDuration - 0.1) {
            setIsPlaying(false);
            audio.pause();
          }
        }
        
        // If we're in a silence gap, check if we need to jump to the next segment
        skipToNextSegmentIfNeeded(currentTime);
      };
      
      const handlePlay = () => {
        setIsPlaying(true);
        console.log("Audio playback started");
      };
      
      const handlePause = () => {
        setIsPlaying(false);
        console.log("Audio playback paused");
      };
      
      const handleEnded = () => {
        setIsPlaying(false);
        console.log("Audio playback ended");
      };
      
      // Event listeners
      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('play', handlePlay);
      audio.addEventListener('pause', handlePause);
      audio.addEventListener('ended', handleEnded);
      
      // Playback rate
      audio.playbackRate = playbackRate;
      
      // Cleanup
      return () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('pause', handlePause);
        audio.removeEventListener('ended', handleEnded);
      };
    }, [audioRef, speechSegments, currentSegment, isPlaying, isSkipping, audioDuration, playbackRate]);

    // Handle playback rate changes
    const changePlaybackRate = (rate: number) => {
      setPlaybackRate(rate);
      if (audioRef.current) {
        audioRef.current.playbackRate = rate;
      }
    };

    // Jump to a specific segment and ensure it's visible
    const jumpToSegment = (index: number) => {
      if (index >= 0 && index < speechSegments.length) {
        const segment = speechSegments[index];
        setCurrentSegment(index);
        
        // Center the segment in the viewport
        const segmentCenter = (segment.start + segment.end) / 2;
        const halfViewport = getViewportDuration() / 2;
        let newStartTime = segmentCenter - halfViewport;
        
        // Keep within bounds
        newStartTime = Math.max(0, Math.min(newStartTime, getMaxViewportStartTime()));
        setViewportStartTime(newStartTime);
        
        // Set playback position to segment start
        if (audioRef.current) {
          audioRef.current.currentTime = segment.start;
          console.log(`Jumped to segment ${index + 1}`);
          if (!isPlaying && audioRef.current.paused) {
            audioRef.current.play().catch(e => console.error("Error playing audio:", e));
          }
        }
      }
    };

    // Skip to the next segment
    const nextSegment = () => {
      const nextIndex = currentSegment + 1;
      if (nextIndex < speechSegments.length) {
        jumpToSegment(nextIndex);
      }
    };

    // Go to the previous segment
    const prevSegment = () => {
      const prevIndex = currentSegment - 1;
      if (prevIndex >= 0) {
        jumpToSegment(prevIndex);
      }
    };

    // Zoom in - show less time in the viewport
    const zoomIn = () => {
      setZoomLevel(prev => Math.min(prev + 0.5, 10.0));
    };

    // Zoom out - show more time in the viewport
    const zoomOut = () => {
      setZoomLevel(prev => Math.max(prev - 0.5, 1.0));
    };

    // Handle mouse events for dragging/scrolling the waveform
    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;
      
      setIsDragging(true);
      setDragStartX(e.nativeEvent.offsetX);
      setDragStartTime(viewportStartTime);
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging || !canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const dx = e.nativeEvent.offsetX - dragStartX;
      const timeOffset = -(dx / canvas.width) * getViewportDuration();
      
      // Calculate new viewport start time
      let newStartTime = dragStartTime + timeOffset;
      
      // Keep within bounds
      newStartTime = Math.max(0, Math.min(newStartTime, getMaxViewportStartTime()));
      
      setViewportStartTime(newStartTime);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleMouseLeave = () => {
      setIsDragging(false);
    };

    // List of segments with transcriptions (if available)
    const renderSegmentList = () => {
      if (!showTranscriptions) return null;

      return (
        <div className="transcript-list mt-6 max-h-[300px] overflow-y-auto border-t-2 border-black pt-4">
          <h4 className="text-sm font-bold mb-2">Transcription</h4>
          
          {speechSegments.length === 0 ? (
            <p className="text-sm text-gray-500">No transcribed segments available.</p>
          ) : (
            <ul className="space-y-1">
              {speechSegments.map((segment, index) => {


                const timestamp = `${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s`;
                
                return (
                  <li
                    key={index}
                    className={`p-2 rounded text-sm cursor-pointer border ${
                      currentSegment === index ? "bg-green-100 border-green-300" : "bg-gray-100 border-gray-200 hover:bg-gray-200"
                    }`}
                    onClick={() => jumpToSegment(index)}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-mono text-xs text-gray-500">{timestamp}</span>
                      <span className="text-xs px-1 rounded">
                        {segment.error && (
                          <span className="text-red-500 text-xs">Error: {segment.error}</span>
                        )}
                        {segment.skipped && (
                          <span className="text-orange-500 text-xs">Skipped</span>
                        )}
                      </span>
                    </div>
                    <p className="mt-1">
                      {segment.text ? segment.text : (
                        <span className="text-gray-400 italic">
                          {segment.error || segment.skipped ? "Not transcribed" : "No speech detected"}
                        </span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      );
    };

    return (
      <div className="audio-player flex flex-col gap-3 p-4 border-2 border-black bg-white neo-brutalism-card">
        <h3 className="text-sm font-bold border-b-2 border-black pb-2">
          Speech Segments Player
        </h3>

        <div className="player-container">
          {/* Waveform visualization */}
          <div className="waveform-container mb-2">
            {loading ? (
              <div className="flex items-center justify-center h-[100px] border border-gray-300 bg-gray-100">
                <p className="text-sm text-gray-500">Loading waveform...</p>
              </div>
            ) : (
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={100}
                  className="w-full border border-gray-300 cursor-grab"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                />
                <div className="absolute top-2 right-2 flex gap-1">
                  <Button
                    onClick={zoomIn}
                    className="h-6 w-6 p-0 flex items-center justify-center bg-white border border-gray-300 text-black hover:text-white cursor-pointer"
                    title="Zoom in (show less time)"
                  >
                    <span className="text-lg font-bold">+</span>
                  </Button>
                  <Button
                    onClick={zoomOut}
                    className="h-6 w-6 p-0 flex items-center justify-center bg-white border border-gray-300 text-black hover:text-white cursor-pointer"
                    title="Zoom out (show more time)"
                  >
                    <span className="text-lg font-bold">-</span>
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Native audio element for greater browser compatibility */}
          <audio
            ref={audioRef}
            src={audioUrl}
            controls
            className="w-full neo-brutalism-audio mt-2 bg-[#f1f3f4]"
          />

          <div className="controls flex items-center gap-2 flex-wrap mt-3">
            <div className="flex gap-1">
              <Button
                onClick={prevSegment}
                className="neo-brutalism-button px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300"
              >
                Prev Segment
              </Button>
              <Button
                onClick={nextSegment}
                className="neo-brutalism-button px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300"
              >
                Next Segment
              </Button>
            </div>

            <div className="flex gap-1 ml-2">
              <Button
                onClick={() => changePlaybackRate(1)}
                className={`neo-brutalism-button px-2 py-1 text-xs ${
                  playbackRate === 1
                    ? "bg-green-500"
                    : "bg-gray-200 hover:bg-gray-300"
                }`}
              >
                1x
              </Button>
              <Button
                onClick={() => changePlaybackRate(1.5)}
                className={`neo-brutalism-button px-2 py-1 text-xs ${
                  playbackRate === 1.5
                    ? "bg-green-500"
                    : "bg-gray-200 hover:bg-gray-300"
                }`}
              >
                1.5x
              </Button>
              <Button
                onClick={() => changePlaybackRate(2)}
                className={`neo-brutalism-button px-2 py-1 text-xs ${
                  playbackRate === 2
                    ? "bg-green-500"
                    : "bg-gray-200 hover:bg-gray-300"
                }`}
              >
                2x
              </Button>
            </div>

            <div className="ml-auto text-sm">
              <span className="font-bold">
                Segment {currentSegment + 1} of {speechSegments.length}
              </span>
            </div>
          </div>

          {/* Highlighted time range indicator */}
          {highlightRange && (
            <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
              <div className="font-semibold">Highlighted segment:</div>
              <div className="flex justify-between mt-1">
                <span className="font-mono">
                  {Math.floor(highlightRange.start / 60).toString().padStart(2, '0')}:
                  {Math.floor(highlightRange.start % 60).toString().padStart(2, '0')}.
                  {Math.floor((highlightRange.start % 1) * 10)} - 
                  {Math.floor(highlightRange.end / 60).toString().padStart(2, '0')}:
                  {Math.floor(highlightRange.end % 60).toString().padStart(2, '0')}.
                  {Math.floor((highlightRange.end % 1) * 10)}
                </span>
                <span>Duration: {(highlightRange.end - highlightRange.start).toFixed(1)}s</span>
              </div>
            </div>
          )}
        </div>

        {/* Render the segment list with transcriptions if available */}
        {renderSegmentList()}

        <div className="text-xs text-gray-600 mt-1">
          <p>Red areas show removed silence. Green area shows current segment.</p>
          <p>
            Use +/- buttons to zoom in/out. Click and drag to scroll horizontally.
          </p>
          <p className="mt-1 text-green-600 font-medium">Auto-skipping silence: the player will only play through speech segments.</p>
          {showTranscriptions && (
            <p className="text-blue-600">Click on any transcription segment to jump to that part of the audio.</p>
          )}
        </div>

        <style jsx>{`
          .neo-brutalism-audio {
            border: 2px solid #0a0a0a;
            box-shadow: 2px 2px 0px #0a0a0a;
          }
          .playing-indicator {
            display: flex;
            gap: 1px;
          }
          .indicator-bar {
            width: 2px;
            height: 8px;
            background-color: #22c55e;
            animation: sound 0.5s infinite alternate;
          }
          .bar1 { animation-delay: 0.0s; }
          .bar2 { animation-delay: 0.2s; }
          .bar3 { animation-delay: 0.4s; }
          @keyframes sound {
            0% { height: 3px; }
            100% { height: 8px; }
          }
        `}</style>
      </div>
    );
  }
);
