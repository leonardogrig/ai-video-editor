import { createSrtFromSegments, createXmlFromSegments } from "./utils";
import { XmlExportSettings } from "../components/XmlSettingsDialog";

// Function to download SRT file
export const downloadSrt = (segments: any[], filename: string) => {
  const srtContent = createSrtFromSegments(segments);
  const blob = new Blob([srtContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
};

// Function to download XML file
export const downloadXml = (segments: any[], filename: string, settings: XmlExportSettings) => {
  // Make sure we have the required source file information
  if (!settings.sourceFilePath || !settings.sourceFileName) {
    console.error("Missing sourceFilePath or sourceFileName in XML export settings");
    
    // Use a consistent path format with videos directory
    const fileName = filename.includes('.') ? filename : filename + '.mp4';
    const filePath = `file://localhost/videos/${encodeURIComponent(fileName)}`;
    
    // Use defaults if not provided
    settings.sourceFilePath = settings.sourceFilePath || filePath;
    settings.sourceFileName = settings.sourceFileName || fileName;
    
    console.log("Using fallback source file info:", {
      path: settings.sourceFilePath,
      name: settings.sourceFileName
    });
  }
  
  // Log the exact settings we're using
  console.log("FINAL XML EXPORT SETTINGS:", JSON.stringify(settings, null, 2));
  
  // REMOVE path consistency check to respect the exact path provided
  // Don't automatically convert any path to use the /videos/ directory
  
  const xmlContent = createXmlFromSegments(segments, settings);
  const blob = new Blob([xmlContent], { type: 'text/xml' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
};

// Function to download JSON data
export const downloadJson = (data: any, filename: string) => {
  // Create blob from data
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  
  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  
  // Append to document, click, then remove
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
};

// Extract filename from URL for naming downloaded files
export const getBaseFilename = (audioUrl: string): string => {
  if (!audioUrl) return 'transcription';
  
  // Try to extract filename from URL
  const urlParts = audioUrl.split('/');
  const filenameWithExt = urlParts[urlParts.length - 1];
  const filename = filenameWithExt.split('.')[0] || 'transcription';
  
  return filename;
}; 