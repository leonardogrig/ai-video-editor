import { NextRequest, NextResponse } from "next/server";
import { writeFile, appendFile, mkdir } from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// Configuration for the API route
export const config = {
  api: {
    responseLimit: false,
    bodyParser: {
      sizeLimit: "50mb" // Set reasonable chunk size
    }
  },
};

// Ensure temp directory exists
async function ensureTempDir() {
  const tempDir = path.join(os.tmpdir(), "video-processor-chunks");
  if (!fs.existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }
  return tempDir;
}

export async function POST(request: NextRequest) {
  try {
    // Parse the form data
    const formData = await request.formData();
    
    const chunkIndex = Number(formData.get("chunkIndex"));
    const totalChunks = Number(formData.get("totalChunks"));
    const fileName = formData.get("fileName") as string;
    const fileSize = Number(formData.get("fileSize"));
    const chunk = formData.get("chunk") as File;
    const sessionId = formData.get("sessionId") as string;
    
    if (!chunk || isNaN(chunkIndex) || !fileName || isNaN(totalChunks)) {
      return NextResponse.json({ error: "Invalid chunk data" }, { status: 400 });
    }
    
    const tempDir = await ensureTempDir();
    
    // Create a session directory
    const sessionDir = path.join(tempDir, sessionId);
    if (!fs.existsSync(sessionDir)) {
      await mkdir(sessionDir, { recursive: true });
    }
    
    // Create metadata file if it's the first chunk
    if (chunkIndex === 0) {
      const metadataPath = path.join(sessionDir, "metadata.json");
      await writeFile(metadataPath, JSON.stringify({
        fileName,
        totalChunks,
        fileSize,
        receivedChunks: [],
        completed: false
      }));
    }
    
    // Update metadata with received chunk
    const metadataPath = path.join(sessionDir, "metadata.json");
    if (!fs.existsSync(metadataPath)) {
      return NextResponse.json({ error: "Session not initialized" }, { status: 400 });
    }
    
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    
    // Save the chunk
    const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
    const arrayBuffer = await chunk.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(chunkPath, buffer);
    
    // Update metadata
    if (!metadata.receivedChunks.includes(chunkIndex)) {
      metadata.receivedChunks.push(chunkIndex);
    }
    
    await writeFile(metadataPath, JSON.stringify(metadata));
    
    const isComplete = metadata.receivedChunks.length === totalChunks;
    
    // If all chunks received, combine them
    if (isComplete) {
      const targetPath = path.join(sessionDir, fileName);
      
      // Create an empty file
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      await writeFile(targetPath, Buffer.alloc(0));
      
      // Append chunks in order
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(sessionDir, `chunk_${i}`);
        if (fs.existsSync(chunkPath)) {
          const chunkData = fs.readFileSync(chunkPath);
          await appendFile(targetPath, chunkData);
        } else {
          return NextResponse.json({ 
            error: `Missing chunk ${i}`,
            status: "incomplete"
          }, { status: 400 });
        }
      }
      
      // Update metadata
      metadata.completed = true;
      await writeFile(metadataPath, JSON.stringify(metadata));
      
      return NextResponse.json({ 
        status: "complete", 
        filePath: targetPath,
        fileName,
        fileSize
      });
    }
    
    return NextResponse.json({ 
      status: "progress", 
      received: metadata.receivedChunks.length, 
      total: totalChunks,
      progress: Math.round((metadata.receivedChunks.length / totalChunks) * 100)
    });
  } catch (error) {
    console.error("Error processing chunk:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
} 