import { NextRequest, NextResponse } from 'next/server';
import { SpeechSegment } from '@/components/types';

// Example schema format from OpenRouter's documentation for structured outputs
const StructuredOutputSchema = {
  type: "object",
  properties: {
    filtered_transcription: {
      type: "array",
      description: "A list of transcription segments to keep, in chronological order.",
      items: {
        type: "object",
        properties: {
          start: {
            type: "number",
            description: "Start time of the segment in seconds"
          },
          end: {
            type: "number",
            description: "End time of the segment in seconds"
          },
          text: {
            type: "string",
            description: "Transcribed text content of the segment"
          }
        },
        required: ["start", "end", "text"]
      }
    }
  },
  required: ["filtered_transcription"]
};

// Add API route configuration
export const config = {
  api: {
    responseLimit: false,
    bodyParser: {
      sizeLimit: Infinity // No size limit for local development
    }
  },
};

// Add a function to call OpenRouter with different models
async function callOpenRouterWithModel(apiKey: string, segments: SpeechSegment[], prompt: string, model: string) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://localhost:3000',
      'X-Title': 'Video Editor - Segment Filtering'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify(segments) }
      ],
      response_format: {
        type: "json_object",
        schema: StructuredOutputSchema
      }
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    console.error(`OpenRouter API error with model ${model}:`, errorData);
    throw new Error(`Failed to process with model ${model}: ${errorData.error || 'Unknown error'}`);
  }
  
  return await response.json();
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json({ 
        error: "OpenRouter API key is not configured. Please add OPENROUTER_API_KEY to your environment variables."
      }, { status: 500 });
    }
    
    // Parse request body
    const body = await request.json();
    const segments = body.segments as SpeechSegment[];
    
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json({ error: "Invalid or empty segments data" }, { status: 400 });
    }
    
    // Build a detailed prompt with explicit instructions
    const prompt = `
      You are given a raw JSON transcription of a video as an array of objects.
      Each object has three keys: 'start' (a number indicating the start time in seconds),
      'end' (a number indicating the end time in seconds), and 'text' (a string with the transcribed speech).

      Your task is to remove any segments that are redundant, duplicate, or mistaken.
      Specifically, if two or more segments have the same or nearly identical 'text' (ignoring minor differences such as punctuation or trailing ellipses),
      only keep the segment with the highest start time (i.e. the last occurrence) and remove all earlier duplicates.
      The final output should be a JSON array of the remaining segments, in chronological order by 'start' time.
      Observe that sometimes the segments may be rephrased, so consider this a duplication and always consider the last occurrence.
      
      Example of input with duplicates:
      [{ "start": 6.84, "end": 9.8, "text": "In my previous video, I've reached..." }, 
       { "start": 12.24, "end": 15.08, "text": "In my previous video, I've reached many comments." }, 
       { "start": 15.84, "end": 24.17, "text": "In my previous video I've received many comments asking why use an LLM to scrape if we can just use normal selenium, beautiful soup, or puppeteer." }]
      
      In this example, you would only retain the last object since they're all variations of the same point.
      
      Your output should be in this format:
      {
        "filtered_transcription": [
          {
            "start": 15.84,
            "end": this actual segment end,
            "text": "this is the text" 
          },
          ... additional segments ...
        ]
      }
    `;
    
    // Try with different models in sequence until one works
    const models = [
      'google/gemini-2.0-flash-001',
      'google/gemini-2.5-pro-exp-03-25:free',
      'openai/gpt-4o-2024-11-20'
    ];
    
    let data;
    let selectedModel = '';
    let error = null;
    
    // Try each model in sequence until one works
    for (const model of models) {
      try {
        console.log(`Trying with model: ${model}`);
        data = await callOpenRouterWithModel(apiKey, segments, prompt, model);
        selectedModel = model;
        console.log(`Successfully processed with model: ${model}`);
        break;
      } catch (e) {
        console.error(`Error with model ${model}:`, e);
        error = e;
        // Continue to the next model
      }
    }
    
    // If all models failed, return an error
    if (!data) {
      console.error('All models failed:', error);
      return NextResponse.json({
        error: "Failed to process with any available model",
        filteredSegments: segments, // Return original segments as fallback
      }, { status: 200 }); // Use 200 to avoid UI errors
    }
    
    console.log(`OpenRouter API response from ${selectedModel}:`, JSON.stringify(data, null, 2));
    
    // Get the content from the response
    const content = data.choices?.[0]?.message?.content;
    console.log('OpenRouter content:', content);
    
    // Try to parse the content
    let parsedContent;
    try {
      // If the content is already an object, use it directly
      if (typeof content === 'object' && content !== null) {
        parsedContent = content;
      } 
      // If it's a string, try to parse it as JSON
      else if (typeof content === 'string') {
        parsedContent = JSON.parse(content);
      }
      else {
        throw new Error(`Unexpected content type: ${typeof content}`);
      }
      
      console.log('Parsed content:', JSON.stringify(parsedContent, null, 2));
      
      // Check if the parsed content has the expected format
      if (!parsedContent || !parsedContent.filtered_transcription) {
        // If direct validation fails, try to extract from the message content differently
        // Sometimes LLMs don't adhere to the schema perfectly
        console.log('Expected structure not found, attempting fallback extraction...');
        
        // Fallback: Try to find any array in the response that might contain our segments
        if (Array.isArray(parsedContent)) {
          // If the content is directly an array, use it
          return NextResponse.json({ 
            filteredSegments: parsedContent,
            model: selectedModel
          });
        }
        
        // Check if there's any property that contains an array
        for (const key in parsedContent) {
          if (Array.isArray(parsedContent[key])) {
            console.log(`Found array in property: ${key}`);
            return NextResponse.json({ 
              filteredSegments: parsedContent[key],
              model: selectedModel
            });
          }
        }
        
        // Last resort: If no segments were found but we have segments from the input,
        // just filter out ones without text as a minimal processing
        const minimalFiltered = segments.filter(seg => seg.text && seg.text.trim() !== '');
        
        console.log('Using minimal filtering as fallback with', minimalFiltered.length, 'segments');
        return NextResponse.json({ 
          filteredSegments: minimalFiltered,
          warning: "Used fallback filtering due to unexpected API response format",
          model: selectedModel
        });
      }
      
      // Success path - we have the expected format
      return NextResponse.json({ 
        filteredSegments: parsedContent.filtered_transcription,
        model: selectedModel
      });
      
    } catch (e) {
      console.error('Error parsing content:', e);
      console.log('Raw content that failed to parse:', content);
      
      // Return a fallback filtered list (the original list)
      return NextResponse.json({ 
        filteredSegments: segments,
        error: "Failed to parse filtered segments, returning original segments",
        details: e instanceof Error ? e.message : 'Unknown error',
        model: selectedModel
      }, { status: 200 }); // Still return 200 to avoid UI errors
    }
    
  } catch (error) {
    console.error('Error in segment filtering:', error);
    // Get segments from the request if available
    let segments: SpeechSegment[] = [];
    try {
      const bodyData = await request.json().catch(() => ({}));
      segments = bodyData.segments || [];
    } catch {
      // If we can't parse the body, just use an empty array
    }
    
    return NextResponse.json({ 
      error: "An error occurred while filtering segments", 
      details: error instanceof Error ? error.message : 'Unknown error',
      filteredSegments: segments // Return original segments as fallback
    }, { status: 200 }); // Use 200 to avoid UI errors
  }
} 