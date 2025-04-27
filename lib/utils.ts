import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format time in seconds to mm:ss.s format
export const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return "00:00.0";
  
  // Calculate minutes and remaining seconds
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  // Format with leading zeros for minutes and seconds
  const minutesStr = minutes.toString().padStart(2, '0');
  const secondsStr = remainingSeconds.toFixed(1).padStart(4, '0');
  
  return `${minutesStr}:${secondsStr}`;
};

// Format timestamp for SRT files (HH:MM:SS,mmm)
export const formatSrtTimestamp = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
};

// Escape XML characters
export const escapeXml = (text: string): string => {
  if (typeof text !== 'string') {
    return ''; // Return empty string if text is not valid
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;'); // Also escape single quotes
};

// Convert segments to Premiere Pro XML format
export const createXmlFromSegments = (
  segments: any[], 
  settings: {
    frameRate: number, 
    width: number, 
    height: number, 
    pixelAspectRatio: string,
    fields: string,
    sourceFilePath: string
  }
): string => {
  // Get settings or use defaults
  const sequenceName = "Generated Sequence";
  const frameRate = settings.frameRate;  
  const width = settings.width;
  const height = settings.height;
  const pixelAspectRatio = settings.pixelAspectRatio;
  const fields = settings.fields;
  
  // Make sure we use the provided file path
  const sourceFilePath = settings.sourceFilePath;
  
  if (!sourceFilePath) {
    console.error("sourceFilePath must be provided to createXmlFromSegments");
    throw new Error("Missing required parameter: sourceFilePath");
  }
  
  // Extract filename from path
  const getFileNameFromPath = (path: string): string => {
    // Remove any trailing slashes
    const cleanPath = path.replace(/[\/\\]$/, '');
    // Split by slashes (both forward and backward)
    const parts = cleanPath.split(/[\/\\]/);
    // Return the last part as the filename
    return parts[parts.length - 1] || 'video.mp4';
  };
  
  // Get filename from the path
  const sourceFileName = getFileNameFromPath(sourceFilePath);
  
  // Log these important values clearly
  console.log("XML GENERATION - Using source file:", sourceFileName);
  console.log("XML GENERATION - Using source path:", sourceFilePath);
  
  // Generate UUIDs for XML elements
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
  
  // Calculate timebase based on frame rate
  const timebase = Math.round(frameRate);
  const ntscFlag = frameRate % 1 !== 0 ? 'TRUE' : 'FALSE';

  // Helper to convert seconds to frames
  const secondsToFrames = (seconds: number): number => {
    return Math.round(seconds * frameRate);
  };

  // Calculate total sequence duration in frames (find the end time of the last segment)
  const maxEndFrame = segments.reduce((max, seg) => {
    const endFrame = secondsToFrames(seg.end);
    return endFrame > max ? endFrame : max;
  }, 0);

  // Generate UUIDs for the sequence and master clip
  const sequenceUUID = generateUUID();
  const masterClipUUID = "masterclip-1";
  const fileId = "file-1";
  
  // Calculate total source file duration (using the largest end time)
  const sourceDuration = Math.max(...segments.map(seg => secondsToFrames(seg.end)));
  
  // Start XML structure
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<!DOCTYPE xmeml>\n';
  xml += '<xmeml version="4">\n';
  
  // Create sequence structure matching exported.xml structure
  xml += `  <sequence id="sequence-${Math.floor(Math.random() * 1000)}" TL.SQAudioVisibleBase="0" TL.SQVideoVisibleBase="0" TL.SQVisibleBaseTime="0" TL.SQAVDividerPosition="0.5" TL.SQHideShyTracks="0" TL.SQHeaderWidth="236" Monitor.ProgramZoomOut="11976854400000" Monitor.ProgramZoomIn="0" TL.SQTimePerPixel="0.11743479814219364" MZ.EditLine="7247923200000" MZ.Sequence.PreviewFrameSizeHeight="${height}" MZ.Sequence.PreviewFrameSizeWidth="${width}" MZ.Sequence.AudioTimeDisplayFormat="200" MZ.Sequence.PreviewRenderingClassID="1061109567" MZ.Sequence.PreviewRenderingPresetCodec="1634755443" MZ.Sequence.PreviewRenderingPresetPath="EncoderPresets\\SequencePreview\\9678af98-a7b7-4bdb-b477-7ac9c8df4a4e\\QuickTime.epr" MZ.Sequence.PreviewUseMaxRenderQuality="false" MZ.Sequence.PreviewUseMaxBitDepth="false" MZ.Sequence.EditingModeGUID="9678af98-a7b7-4bdb-b477-7ac9c8df4a4e" MZ.Sequence.VideoTimeDisplayFormat="108" MZ.WorkOutPoint="13915843200000" MZ.WorkInPoint="0" explodedTracks="true">\n`;
  xml += `    <uuid>${sequenceUUID}</uuid>\n`;
  xml += `    <duration>${maxEndFrame}</duration>\n`;
  xml += '    <rate>\n';
  xml += `      <timebase>${timebase}</timebase>\n`;
  xml += `      <ntsc>${ntscFlag}</ntsc>\n`;
  xml += '    </rate>\n';
  xml += `    <name>${escapeXml(sequenceName)}</name>\n`;
  xml += '    <media>\n';
  xml += '      <video>\n';
  xml += '        <format>\n';
  xml += '          <samplecharacteristics>\n';
  xml += '            <rate>\n';
  xml += `              <timebase>${timebase}</timebase>\n`;
  xml += `              <ntsc>${ntscFlag}</ntsc>\n`;
  xml += '            </rate>\n';
  xml += '            <codec>\n';
  xml += '              <name>Apple ProRes 422</name>\n';
  xml += '              <appspecificdata>\n';
  xml += '                <appname>Final Cut Pro</appname>\n';
  xml += '                <appmanufacturer>Apple Inc.</appmanufacturer>\n';
  xml += '                <appversion>7.0</appversion>\n';
  xml += '                <data>\n';
  xml += '                  <qtcodec>\n';
  xml += '                    <codecname>Apple ProRes 422</codecname>\n';
  xml += '                    <codectypename>Apple ProRes 422</codectypename>\n';
  xml += '                    <codectypecode>apcn</codectypecode>\n';
  xml += '                    <codecvendorcode>appl</codecvendorcode>\n';
  xml += '                    <spatialquality>1024</spatialquality>\n';
  xml += '                    <temporalquality>0</temporalquality>\n';
  xml += '                    <keyframerate>0</keyframerate>\n';
  xml += '                    <datarate>0</datarate>\n';
  xml += '                  </qtcodec>\n';
  xml += '                </data>\n';
  xml += '              </appspecificdata>\n';
  xml += '            </codec>\n';
  xml += `            <width>${width}</width>\n`;
  xml += `            <height>${height}</height>\n`;
  xml += '            <anamorphic>FALSE</anamorphic>\n';
  xml += `            <pixelaspectratio>${pixelAspectRatio}</pixelaspectratio>\n`;
  xml += `            <fielddominance>${fields}</fielddominance>\n`;
  xml += '            <colordepth>24</colordepth>\n';
  xml += '          </samplecharacteristics>\n';
  xml += '        </format>\n';
  xml += '        <track TL.SQTrackShy="0" TL.SQTrackExpandedHeight="25" TL.SQTrackExpanded="0" MZ.TrackTargeted="1">\n';
  
  // Add video segments as clips
  segments.forEach((segment, index) => {
    const startFrame = secondsToFrames(segment.start);
    const endFrame = secondsToFrames(segment.end);
    const durationFrames = endFrame - startFrame;
    
    // Calculate in/out points - these are frames within the source file
    // In the exported.xml, these correspond to the portion of the source file being used
    const inPoint = startFrame; // Assuming segment.start is relative to the beginning of the source
    const outPoint = endFrame;  // Assuming segment.end is relative to the beginning of the source
    
    const clipId = `clipitem-${500 + index * 2}`;
    const audioClipId1 = `clipitem-${501 + index * 2}`;
    
    // Ensure duration is at least 1 frame
    if (durationFrames <= 0) {
      console.warn(`Segment ${index + 1} has zero or negative duration, skipping.`);
      return; // Skip segments with no duration
    }
    
    // Video clip item that matches exported.xml structure
    xml += `          <clipitem id="${clipId}">\n`;
    xml += `            <masterclipid>${masterClipUUID}</masterclipid>\n`;
    xml += `            <name>${escapeXml(sourceFileName)}</name>\n`;
    xml += '            <enabled>TRUE</enabled>\n';
    xml += `            <duration>${sourceDuration}</duration>\n`;
    xml += '            <rate>\n';
    xml += `              <timebase>${timebase}</timebase>\n`;
    xml += `              <ntsc>${ntscFlag}</ntsc>\n`;
    xml += '            </rate>\n';
    xml += `            <start>${startFrame}</start>\n`;
    xml += `            <end>${endFrame}</end>\n`;
    xml += `            <in>${inPoint}</in>\n`;
    xml += `            <out>${outPoint}</out>\n`;
    xml += `            <pproTicksIn>${inPoint * 4230000000}</pproTicksIn>\n`;
    xml += `            <pproTicksOut>${outPoint * 4230000000}</pproTicksOut>\n`;
    xml += '            <alphatype>none</alphatype>\n';
    xml += '            <pixelaspectratio>square</pixelaspectratio>\n';
    xml += '            <anamorphic>FALSE</anamorphic>\n';
    
    // Reference the same file for all clips
    xml += `            <file id="${fileId}">\n`;
    xml += `              <name>${escapeXml(sourceFileName)}</name>\n`;
    xml += `              <pathurl>${escapeXml(sourceFilePath)}</pathurl>\n`;
    xml += '              <rate>\n';
    xml += `                <timebase>${timebase}</timebase>\n`;
    xml += `                <ntsc>${ntscFlag}</ntsc>\n`;
    xml += '              </rate>\n';
    xml += `              <duration>${sourceDuration}</duration>\n`;
    xml += '              <timecode>\n';
    xml += '                <rate>\n';
    xml += `                  <timebase>${timebase}</timebase>\n`;
    xml += `                  <ntsc>${ntscFlag}</ntsc>\n`;
    xml += '                </rate>\n';
    xml += '                <string>00:00:00:00</string>\n';
    xml += '                <frame>0</frame>\n';
    xml += '                <displayformat>NDF</displayformat>\n';
    xml += '              </timecode>\n';
    xml += '              <media>\n';
    xml += '                <video>\n';
    xml += '                  <samplecharacteristics>\n';
    xml += '                    <rate>\n';
    xml += `                      <timebase>${timebase}</timebase>\n`;
    xml += `                      <ntsc>${ntscFlag}</ntsc>\n`;
    xml += '                    </rate>\n';
    xml += `                    <width>${width}</width>\n`;
    xml += `                    <height>${height}</height>\n`;
    xml += '                    <anamorphic>FALSE</anamorphic>\n';
    xml += '                    <pixelaspectratio>square</pixelaspectratio>\n';
    xml += '                    <fielddominance>none</fielddominance>\n';
    xml += '                  </samplecharacteristics>\n';
    xml += '                </video>\n';
    xml += '                <audio>\n';
    xml += '                  <samplecharacteristics>\n';
    xml += '                    <depth>16</depth>\n';
    xml += '                    <samplerate>48000</samplerate>\n';
    xml += '                  </samplecharacteristics>\n';
    xml += '                  <channelcount>2</channelcount>\n';
    xml += '                </audio>\n';
    xml += '              </media>\n';
    xml += '            </file>\n';
    
    // Add link to audio track
    xml += '            <link>\n';
    xml += `              <linkclipref>${clipId}</linkclipref>\n`;
    xml += '              <mediatype>video</mediatype>\n';
    xml += '              <trackindex>1</trackindex>\n';
    xml += `              <clipindex>${index + 1}</clipindex>\n`;
    xml += '            </link>\n';
    xml += '            <link>\n';
    xml += `              <linkclipref>${audioClipId1}</linkclipref>\n`;
    xml += '              <mediatype>audio</mediatype>\n';
    xml += '              <trackindex>1</trackindex>\n';
    xml += `              <clipindex>${index + 1}</clipindex>\n`;
    xml += '              <groupindex>1</groupindex>\n';
    xml += '            </link>\n';
    
    // Add basic metadata
    xml += '            <logginginfo>\n';
    xml += '              <description></description>\n';
    xml += '              <scene></scene>\n';
    xml += '              <shottake></shottake>\n';
    xml += '              <lognote></lognote>\n';
    xml += '              <good></good>\n';
    xml += '              <originalvideofilename></originalvideofilename>\n';
    xml += '              <originalaudiofilename></originalaudiofilename>\n';
    xml += '            </logginginfo>\n';
    xml += '            <colorinfo>\n';
    xml += '              <lut></lut>\n';
    xml += '              <lut1></lut1>\n';
    xml += '              <asc_sop></asc_sop>\n';
    xml += '              <asc_sat></asc_sat>\n';
    xml += '              <lut2></lut2>\n';
    xml += '            </colorinfo>\n';
    xml += '            <labels>\n';
    xml += '              <label2>Iris</label2>\n';
    xml += '            </labels>\n';
    xml += '          </clipitem>\n';
  });
  
  // Close video track and add empty tracks
  xml += '          <enabled>TRUE</enabled>\n';
  xml += '          <locked>FALSE</locked>\n';
  xml += '        </track>\n';
  xml += '        <track TL.SQTrackShy="0" TL.SQTrackExpandedHeight="25" TL.SQTrackExpanded="0" MZ.TrackTargeted="0">\n';
  xml += '          <enabled>TRUE</enabled>\n';
  xml += '          <locked>FALSE</locked>\n';
  xml += '        </track>\n';
  xml += '        <track TL.SQTrackShy="0" TL.SQTrackExpandedHeight="25" TL.SQTrackExpanded="0" MZ.TrackTargeted="0">\n';
  xml += '          <enabled>TRUE</enabled>\n';
  xml += '          <locked>FALSE</locked>\n';
  xml += '        </track>\n';
  xml += '      </video>\n';
  
  // Add audio section
  xml += '      <audio>\n';
  xml += '        <numOutputChannels>2</numOutputChannels>\n';
  xml += '        <format>\n';
  xml += '          <samplecharacteristics>\n';
  xml += '            <depth>16</depth>\n';
  xml += '            <samplerate>48000</samplerate>\n';
  xml += '          </samplecharacteristics>\n';
  xml += '        </format>\n';
  xml += '        <outputs>\n';
  xml += '          <group>\n';
  xml += '            <index>1</index>\n';
  xml += '            <numchannels>1</numchannels>\n';
  xml += '            <downmix>0</downmix>\n';
  xml += '            <channel>\n';
  xml += '              <index>1</index>\n';
  xml += '            </channel>\n';
  xml += '          </group>\n';
  xml += '          <group>\n';
  xml += '            <index>2</index>\n';
  xml += '            <numchannels>1</numchannels>\n';
  xml += '            <downmix>0</downmix>\n';
  xml += '            <channel>\n';
  xml += '              <index>2</index>\n';
  xml += '            </channel>\n';
  xml += '          </group>\n';
  xml += '        </outputs>\n';
  
  // Add audio track
  xml += '        <track TL.SQTrackAudioKeyframeStyle="0" TL.SQTrackShy="0" TL.SQTrackExpandedHeight="25" TL.SQTrackExpanded="0" MZ.TrackTargeted="1" PannerCurrentValue="0.5" PannerIsInverted="true" PannerStartKeyframe="-91445760000000000,0.5,0,0,0,0,0,0" PannerName="Balance" currentExplodedTrackIndex="0" totalExplodedTrackCount="2" premiereTrackType="Mono">\n';
  
  // Add audio clips
  segments.forEach((segment, index) => {
    const startFrame = secondsToFrames(segment.start);
    const endFrame = secondsToFrames(segment.end);
    const durationFrames = endFrame - startFrame;
    
    // Calculate in/out points - these are frames within the source file
    const inPoint = startFrame;
    const outPoint = endFrame;
    
    const videoClipId = `clipitem-${500 + index * 2}`;
    const clipId = `clipitem-${501 + index * 2}`;
    
    // Ensure duration is at least 1 frame
    if (durationFrames <= 0) {
      return; // Skip segments with no duration
    }
    
    // Audio clip item
    xml += `          <clipitem id="${clipId}" premiereChannelType="mono">\n`;
    xml += `            <masterclipid>${masterClipUUID}</masterclipid>\n`;
    xml += `            <name>${escapeXml(sourceFileName)}</name>\n`;
    xml += '            <enabled>TRUE</enabled>\n';
    xml += `            <duration>${sourceDuration}</duration>\n`;
    xml += '            <rate>\n';
    xml += `              <timebase>${timebase}</timebase>\n`;
    xml += `              <ntsc>${ntscFlag}</ntsc>\n`;
    xml += '            </rate>\n';
    xml += `            <start>${startFrame}</start>\n`;
    xml += `            <end>${endFrame}</end>\n`;
    xml += `            <in>${inPoint}</in>\n`;
    xml += `            <out>${outPoint}</out>\n`;
    xml += `            <pproTicksIn>${inPoint * 4230000000}</pproTicksIn>\n`;
    xml += `            <pproTicksOut>${outPoint * 4230000000}</pproTicksOut>\n`;
    xml += `            <file id="${fileId}"/>\n`;
    xml += '            <sourcetrack>\n';
    xml += '              <mediatype>audio</mediatype>\n';
    xml += '              <trackindex>1</trackindex>\n';
    xml += '            </sourcetrack>\n';
    
    // Add links to video and audio
    xml += '            <link>\n';
    xml += `              <linkclipref>${videoClipId}</linkclipref>\n`;
    xml += '              <mediatype>video</mediatype>\n';
    xml += '              <trackindex>1</trackindex>\n';
    xml += `              <clipindex>${index + 1}</clipindex>\n`;
    xml += '            </link>\n';
    xml += '            <link>\n';
    xml += `              <linkclipref>${clipId}</linkclipref>\n`;
    xml += '              <mediatype>audio</mediatype>\n';
    xml += '              <trackindex>1</trackindex>\n';
    xml += `              <clipindex>${index + 1}</clipindex>\n`;
    xml += '              <groupindex>1</groupindex>\n';
    xml += '            </link>\n';
    
    // Add basic metadata
    xml += '            <logginginfo>\n';
    xml += '              <description></description>\n';
    xml += '              <scene></scene>\n';
    xml += '              <shottake></shottake>\n';
    xml += '              <lognote></lognote>\n';
    xml += '              <good></good>\n';
    xml += '              <originalvideofilename></originalvideofilename>\n';
    xml += '              <originalaudiofilename></originalaudiofilename>\n';
    xml += '            </logginginfo>\n';
    xml += '            <colorinfo>\n';
    xml += '              <lut></lut>\n';
    xml += '              <lut1></lut1>\n';
    xml += '              <asc_sop></asc_sop>\n';
    xml += '              <asc_sat></asc_sat>\n';
    xml += '              <lut2></lut2>\n';
    xml += '            </colorinfo>\n';
    xml += '            <labels>\n';
    xml += '              <label2>Iris</label2>\n';
    xml += '            </labels>\n';
    xml += '          </clipitem>\n';
  });
  
  // Close audio track and add empty tracks
  xml += '          <enabled>TRUE</enabled>\n';
  xml += '          <locked>FALSE</locked>\n';
  xml += '          <outputchannelindex>1</outputchannelindex>\n';
  xml += '        </track>\n';
  
  // Add additional audio tracks to match exported.xml
  xml += '        <track TL.SQTrackAudioKeyframeStyle="0" TL.SQTrackShy="0" TL.SQTrackExpandedHeight="25" TL.SQTrackExpanded="0" MZ.TrackTargeted="1" PannerCurrentValue="0.5" PannerIsInverted="true" PannerStartKeyframe="-91445760000000000,0.5,0,0,0,0,0,0" PannerName="Balance" currentExplodedTrackIndex="1" totalExplodedTrackCount="2" premiereTrackType="Mono">\n';
  xml += '          <enabled>TRUE</enabled>\n';
  xml += '          <locked>FALSE</locked>\n';
  xml += '          <outputchannelindex>2</outputchannelindex>\n';
  xml += '        </track>\n';
  xml += '      </audio>\n';
  xml += '    </media>\n';
  
  // Add timecode and close sequence
  xml += '    <timecode>\n';
  xml += '      <rate>\n';
  xml += `        <timebase>${timebase}</timebase>\n`;
  xml += `        <ntsc>${ntscFlag}</ntsc>\n`;
  xml += '      </rate>\n';
  xml += '      <string>00:00:00:00</string>\n';
  xml += '      <frame>0</frame>\n';
  xml += '      <displayformat>NDF</displayformat>\n';
  xml += '    </timecode>\n';
  xml += '    <labels>\n';
  xml += '      <label2>Forest</label2>\n';
  xml += '    </labels>\n';
  xml += '  </sequence>\n';
  xml += '</xmeml>';
  
  return xml;
};

// Convert segments to SRT format
export const createSrtFromSegments = (segments: any[]): string => {
  let srtContent = '';
  
  segments.forEach((segment, index) => {
    const startTime = formatSrtTimestamp(segment.start);
    const endTime = formatSrtTimestamp(segment.end);
    // Use empty string for segments without text (like silence segments)
    const text = segment.text || '[silence]';
    
    // SRT entry format
    srtContent += `${index + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${text}\n\n`;
  });
  
  return srtContent;
};
