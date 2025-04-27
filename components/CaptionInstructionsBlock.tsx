"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// SRT Instructions Component
export const SrtInstructions = () => {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="mb-3 bg-blue-50 border border-blue-200 rounded p-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center text-sm text-blue-800"
      >
        <span className="font-medium">How to import SRT into Premiere Pro</span>
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      
      {isOpen && (
        <div className="mt-2 text-xs text-gray-700 space-y-2">
          <p className="font-medium">Follow these steps to add the SRT file in Adobe Premiere Pro:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>In Premiere Pro, go to the <span className="font-bold">Window</span> menu and select <span className="font-bold">Text</span> to open the Text panel</li>
            <li>Go to the <span className="font-bold">Captions</span> tab in the Text panel</li>
            <li>Click <span className="font-bold">Create Captions From Transcript</span> in the panel menu</li>
            <li>In the dialog that appears, click <span className="font-bold">Browse</span> and locate your downloaded SRT file</li>
            <li>Review any settings as needed and click <span className="font-bold">OK</span></li>
            <li>The captions will now appear in your sequence and can be edited as needed</li>
          </ol>
          <p className="bg-yellow-100 p-1 mt-1">Tip: Make sure your sequence settings match the frame rate of your video for accurate caption timing.</p>
        </div>
      )}
    </div>
  );
};

// XML Instructions Component
export const XmlInstructions = () => {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="mb-3 bg-purple-50 border border-purple-200 rounded p-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center text-sm text-purple-800"
      >
        <span className="font-medium">How to import XML into Premiere Pro</span>
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      
      {isOpen && (
        <div className="mt-2 text-xs text-gray-700 space-y-2">
          <p className="font-medium">Follow these steps to import the XML file in Adobe Premiere Pro:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>In Premiere Pro, go to <span className="font-bold">File {">"} Import...</span> or press <span className="font-bold">Ctrl+I</span> (Windows) or <span className="font-bold">Cmd+I</span> (Mac)</li>
            <li>Browse to locate your downloaded XML file and select it</li>
            <li>Click <span className="font-bold">Open</span> to import</li>
            <li>The XML will import as a sequence with caption text elements</li>
            <li>Drag the sequence to your timeline or open it to view the text elements</li>
            <li>You may need to adjust text positions, styles, and timings as needed</li>
          </ol>
          <p className="bg-yellow-100 p-1 mt-1">Note: If you experience any import issues, check that your Premiere Pro version supports XML imports. Match your export settings with your sequence settings for best results.</p>
        </div>
      )}
    </div>
  );
};

// Combined Instructions Component
export const CaptionInstructions = () => {
  return (
    <div className="mb-3 space-y-2">
      <SrtInstructions />
      <XmlInstructions />
    </div>
  );
}; 