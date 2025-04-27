import { useRef, useEffect, useState } from 'react';

interface WaveformVisualizerProps {
  audioUrl: string;
  speechSegments: { start: number; end: number }[];
  height?: number;
  waveColor?: string;
  silenceColor?: string;
}

export function WaveformVisualizer({
  audioUrl,
  speechSegments,
  height = 128,
  waveColor = '#3498db',
  silenceColor = 'rgba(255, 0, 0, 0.3)'
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load audio and decode for visualization
  useEffect(() => {
    if (!audioUrl) return;
    
    setLoading(true);
    setError(null);
    
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    fetch(audioUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load audio file');
        }
        return response.arrayBuffer();
      })
      .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
      .then(audioBuffer => {
        setAudioDuration(audioBuffer.duration);
        
        // Get audio data from the left channel
        const channelData = audioBuffer.getChannelData(0);
        setWaveformData(channelData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading audio:', err);
        setError('Failed to load audio data');
        setLoading(false);
      });
      
    return () => {
      audioContext.close();
    };
  }, [audioUrl]);

  // Draw waveform with silence markers
  useEffect(() => {
    if (!canvasRef.current || !waveformData || !audioDuration) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const containerWidth = containerRef.current?.clientWidth || 1000;
    canvas.width = containerWidth;
    canvas.height = height;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw waveform
    const dataPoints = waveformData.length;
    const samplesPerPixel = Math.floor(dataPoints / canvas.width);
    const centerY = canvas.height / 2;
    
    // Draw background
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Create a map of silence areas (inverse of speech segments)
    const silenceAreas: { start: number; end: number }[] = [];
    
    // Start with silence from 0 to first segment start if it exists
    if (speechSegments.length > 0 && speechSegments[0].start > 0) {
      silenceAreas.push({ start: 0, end: speechSegments[0].start });
    }
    
    // Add silences between segments
    for (let i = 0; i < speechSegments.length - 1; i++) {
      if (speechSegments[i + 1].start > speechSegments[i].end) {
        silenceAreas.push({
          start: speechSegments[i].end,
          end: speechSegments[i + 1].start
        });
      }
    }
    
    // Add silence from last segment to end if needed
    if (speechSegments.length > 0 && speechSegments[speechSegments.length - 1].end < audioDuration) {
      silenceAreas.push({
        start: speechSegments[speechSegments.length - 1].end,
        end: audioDuration
      });
    }
    
    // If no speech segments, everything is silence
    if (speechSegments.length === 0) {
      silenceAreas.push({ start: 0, end: audioDuration });
    }
    
    // Draw silence areas first
    ctx.fillStyle = silenceColor;
    silenceAreas.forEach(area => {
      const startX = (area.start / audioDuration) * canvas.width;
      const endX = (area.end / audioDuration) * canvas.width;
      const width = endX - startX;
      ctx.fillRect(startX, 0, width, canvas.height);
    });
    
    // Draw the waveform
    ctx.beginPath();
    ctx.strokeStyle = waveColor;
    ctx.lineWidth = 1;
    
    for (let x = 0; x < canvas.width; x++) {
      const startSample = x * samplesPerPixel;
      let min = 1.0;
      let max = -1.0;
      
      // Find min/max in this pixel's sample range
      for (let i = 0; i < samplesPerPixel; i++) {
        if (startSample + i < dataPoints) {
          const sample = waveformData[startSample + i];
          if (sample < min) min = sample;
          if (sample > max) max = sample;
        }
      }
      
      // Draw the vertical line for this pixel
      const minY = (min * centerY) + centerY;
      const maxY = (max * centerY) + centerY;
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    ctx.stroke();
    
    // Add time markers
    ctx.fillStyle = '#000000';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    
    const markerCount = 10;
    for (let i = 0; i <= markerCount; i++) {
      const x = (i / markerCount) * canvas.width;
      const time = (i / markerCount) * audioDuration;
      ctx.fillText(`${time.toFixed(1)}s`, x, canvas.height - 5);
      
      // Draw tick mark
      ctx.beginPath();
      ctx.moveTo(x, canvas.height - 15);
      ctx.lineTo(x, canvas.height - 20);
      ctx.stroke();
    }
    
  }, [waveformData, audioDuration, height, waveColor, silenceColor, speechSegments]);
  
  return (
    <div className="waveform-container" ref={containerRef}>
      {loading && <div className="waveform-loading">Loading waveform...</div>}
      {error && <div className="waveform-error">{error}</div>}
      <div className="waveform-scroll" style={{ overflowX: 'auto', width: '100%' }}>
        <canvas 
          ref={canvasRef} 
          height={height} 
          style={{ display: loading ? 'none' : 'block' }}
        />
      </div>
      <div className="waveform-legend" style={{ marginTop: '8px', fontSize: '12px', display: 'flex', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '16px', height: '16px', backgroundColor: waveColor }}></div>
          <span>Speech</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '16px', height: '16px', backgroundColor: silenceColor }}></div>
          <span>Silence (Removed)</span>
        </div>
      </div>
    </div>
  );
} 