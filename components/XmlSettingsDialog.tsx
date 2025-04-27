"use client";

import React from "react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface XmlExportSettings {
  frameRate: number;
  width: number;
  height: number;
  pixelAspectRatio: string;
  fields: string;
  sourceFilePath: string;
  sourceFileName?: string;
}

interface XmlSettingsDialogProps {
  segments: any[];
  filenamePrefix: string;
  onExport: (segments: any[], filename: string, settings: XmlExportSettings) => void;
  videoFileName?: string;
  videoFilePath?: string;
}

export function XmlSettingsDialog({
  segments,
  filenamePrefix,
  onExport,
  videoFileName,
  videoFilePath
}: XmlSettingsDialogProps) {
  const [settings, setSettings] = useState<XmlExportSettings>({
    frameRate: 60,
    width: 2560,
    height: 1440,
    pixelAspectRatio: "square",
    fields: "none",
    sourceFilePath: videoFilePath || ""
  });

  // Store just the directory path, not the full file path
  const [directoryPath, setDirectoryPath] = useState("");
  
  // Helper function to format file path for XML
  const formatPathForXml = (folderPath: string, fileName: string) => {
    // Handle empty path case
    if (!folderPath) {
      return videoFilePath || `file://localhost/videos/${encodeURIComponent(fileName)}`;
    }
    
    // Replace backslashes with forward slashes
    let formattedPath = folderPath.replace(/\\/g, '/');
    
    // Remove trailing slash if present
    formattedPath = formattedPath.replace(/\/+$/, '');
    
    // Add the filename to the path
    formattedPath = `${formattedPath}/${fileName}`;
    
    // For full paths like C:/Users/... - just use the path directly
    // Only add file:// prefix if it's a relative path or doesn't have a drive letter
    if (!formattedPath.match(/^[a-z]:/i) && !formattedPath.startsWith('file://')) {
      formattedPath = `file://${formattedPath}`;
    }
    
    // Remove any double slashes (except after file:)
    formattedPath = formattedPath.replace(/([^:])\/\//g, '$1/');
    
    return formattedPath;
  };
  
  // Extract filename from path
  const getFileNameFromPath = (path: string): string => {
    // Remove any trailing slashes
    const cleanPath = path.replace(/[\/\\]$/, '');
    // Split by slashes (both forward and backward)
    const parts = cleanPath.split(/[\/\\]/);
    // Return the last part as the filename
    return parts[parts.length - 1] || '';
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="neo-brutalism-button text-xs bg-purple-500 hover:bg-purple-600 text-white">
          Download XML
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>XML Export Settings</DialogTitle>
          <DialogDescription>
            Configure the XML export settings to match your Premiere Pro sequence.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Video File Location Section */}
          <div className="border-b pb-4 mb-2 bg-yellow-50 p-3">
            <h3 className="text-sm font-medium mb-2 text-yellow-800">Video File Information</h3>
            <p className="text-xs text-yellow-700 mb-3">
              Premiere Pro needs to know the exact location of your video file. Please specify the folder where your video is stored.
            </p>
            
            <div className="space-y-3">
              <div>
                <label htmlFor="filePath" className="text-sm font-medium block mb-1 text-yellow-800">
                  Folder Path (where your video file is located)
                </label>
                <Input
                  id="filePath"
                  placeholder="C:\Users\Videos"
                  value={directoryPath}
                  onChange={(e) => setDirectoryPath(e.target.value)}
                  className="neo-brutalism-input border-yellow-400"
                />
                <p className="text-xs text-yellow-700 mt-1">
                  <strong>Important:</strong> Enter only the folder path where your video is located. The filename will be added automatically.
                  <br />
                  Examples: 
                  <br />
                  • C:\Users\YourName\Videos
                  <br />
                  • /Users/YourName/Movies
                </p>
                
                {videoFileName && (
                  <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
                    <p className="text-xs text-blue-700">
                      <strong>Video file:</strong> {videoFileName}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Original Settings */}
          <div className="grid grid-cols-2 items-center gap-4">
            <label htmlFor="frameRate" className="text-sm font-medium">
              Frame Rate (fps)
            </label>
            <Select
              value={settings.frameRate.toString()}
              onValueChange={(value) => setSettings({ ...settings, frameRate: parseFloat(value) })}
            >
              <SelectTrigger id="frameRate" className="neo-brutalism-input">
                <SelectValue placeholder="Frame Rate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="23.976">23.976 fps</SelectItem>
                <SelectItem value="24">24 fps</SelectItem>
                <SelectItem value="25">25 fps</SelectItem>
                <SelectItem value="29.97">29.97 fps</SelectItem>
                <SelectItem value="30">30 fps</SelectItem>
                <SelectItem value="50">50 fps</SelectItem>
                <SelectItem value="59.94">59.94 fps</SelectItem>
                <SelectItem value="60">60 fps</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 items-center gap-4">
            <label htmlFor="resolution" className="text-sm font-medium">
              Resolution
            </label>
            <Select
              value={`${settings.width}x${settings.height}`}
              onValueChange={(value) => {
                const [width, height] = value.split("x").map(Number);
                setSettings({ ...settings, width, height });
              }}
            >
              <SelectTrigger id="resolution" className="neo-brutalism-input">
                <SelectValue placeholder="Resolution" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1280x720">HD 720p (1280x720)</SelectItem>
                <SelectItem value="1920x1080">Full HD 1080p (1920x1080)</SelectItem>
                <SelectItem value="2560x1440">QHD (2560x1440)</SelectItem>
                <SelectItem value="3840x2160">4K UHD (3840x2160)</SelectItem>
                <SelectItem value="4096x2160">DCI 4K (4096x2160)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 items-center gap-4">
            <label htmlFor="pixelAspect" className="text-sm font-medium">
              Pixel Aspect Ratio
            </label>
            <Select
              value={settings.pixelAspectRatio}
              onValueChange={(value) => setSettings({ ...settings, pixelAspectRatio: value })}
            >
              <SelectTrigger id="pixelAspect" className="neo-brutalism-input">
                <SelectValue placeholder="Pixel Aspect Ratio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="square">Square Pixels (1.0)</SelectItem>
                <SelectItem value="NTSC_D1">NTSC D1 (0.9091)</SelectItem>
                <SelectItem value="PAL_D1">PAL D1 (1.0940)</SelectItem>
                <SelectItem value="HD_anamorphic">HD Anamorphic (1.333)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 items-center gap-4">
            <label htmlFor="fields" className="text-sm font-medium">
              Fields
            </label>
            <Select
              value={settings.fields}
              onValueChange={(value) => setSettings({ ...settings, fields: value })}
            >
              <SelectTrigger id="fields" className="neo-brutalism-input">
                <SelectValue placeholder="Fields" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Progressive (None)</SelectItem>
                <SelectItem value="upper">Upper Field First</SelectItem>
                <SelectItem value="lower">Lower Field First</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              let filePath;
              const fileName = videoFileName || `${filenamePrefix}.mp4`;
              
              if (directoryPath.trim()) {
                // Combine the directory path with the filename
                filePath = formatPathForXml(directoryPath.trim(), fileName);
              } else {
                // Fall back to defaults
                filePath = videoFilePath || `file://localhost/videos/${encodeURIComponent(fileName)}`;
              }
              
              // Log the values being used for debugging
              console.log("===== XML EXPORT =====");
              console.log("File path:", filePath);
              console.log("File name:", fileName);
              console.log("=====================");
              
              const exportSettings = {
                ...settings,
                sourceFilePath: filePath,
                sourceFileName: fileName,
              };
              
              onExport(segments, `${filenamePrefix}.xml`, exportSettings);
            }}
            className="neo-brutalism-button bg-purple-500 hover:bg-purple-600 text-white"
          >
            Export XML
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 