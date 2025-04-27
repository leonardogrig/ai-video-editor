import { useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface UploadCardProps {
  videoSrc: string | null;
  onChange: (event: React.ChangeEvent<HTMLInputElement>, fileInfo?: { fileName: string, filePath: string }) => void;
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
}

export function UploadCard({ videoSrc, onChange, videoRef }: UploadCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Extract file name
      const fileName = file.name;
      
      // Create a path that's web-friendly but without hardcoding a specific user directory
      // Use a format like file://localhost/videos/[filename]
      // The actual filepath doesn't matter for XML export, as long as it's consistent
      const filePath = `file://localhost/videos/${encodeURIComponent(fileName)}`;
      
      // Call the original onChange handler with the file info
      onChange(event, { fileName, filePath });
    } else {
      onChange(event);
    }
  };
  
  return (
    <Card className="w-full max-w-2xl mb-8 neo-brutalism-card mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Upload Video</CardTitle>
        <CardDescription>Select a video file from your computer.</CardDescription>
      </CardHeader>
      <CardContent>
        <Input
          type="file"
          accept="video/*"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="neo-brutalism-input"
        />
        {videoSrc && (
          <div className="mt-4 border-2 border-black">
            <video controls src={videoSrc} className="w-full aspect-video" ref={videoRef || undefined}>
              Your browser does not support the video tag.
            </video>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 