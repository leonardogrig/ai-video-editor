import { InstallationInstructions } from './types';

interface ErrorDisplayProps {
  message: string;
  instructions: InstallationInstructions | null;
}

export function ErrorDisplay({ message, instructions }: ErrorDisplayProps) {
  return (
    <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
      <p className="font-bold">Error:</p>
      <p>{message}</p>
      
      {instructions && (
        <div className="mt-4">
          <p className="font-bold text-lg">FFmpeg Installation Instructions:</p>
          
          <div className="mt-2">
            <p className="font-semibold">Windows:</p>
            <pre className="p-2 bg-gray-100 rounded whitespace-pre-wrap text-sm">
              {instructions.windows}
            </pre>
          </div>
          
          <div className="mt-2">
            <p className="font-semibold">Mac:</p>
            <pre className="p-2 bg-gray-100 rounded whitespace-pre-wrap text-sm">
              {instructions.mac}
            </pre>
          </div>
          
          <div className="mt-2">
            <p className="font-semibold">Linux:</p>
            <pre className="p-2 bg-gray-100 rounded whitespace-pre-wrap text-sm">
              {instructions.linux}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
} 