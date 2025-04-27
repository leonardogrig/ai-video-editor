# AI Video Editor

A powerful AI-powered video editing application built with Next.js that helps you remove silence, transcribe speech, and filter duplicate segments using AI. This project is designed to run locally while providing a modern, user-friendly interface and controls throughout the video editing tasks.

## Features

- **Silence Removal**: Automatically detect and remove silent segments from your videos
- **Speech Transcription**: Transcribe video content using Groq's Distil-Whisper model (reportedly 250x faster and 15x cheaper than OpenAI's Whisper)
- **AI-Powered Duplicate Detection**: Identify and remove duplicate segments using AI
- **Modern UI**: Built with Next.js and featuring a neo-brutalist design
- **Local Processing**: All processing happens locally on your machine
- **Export Options**: Export to various formats including Premiere Pro XML

## Prerequisites

- Node.js 18+ and Yarn
- FFMPEG installed on your system
- API keys for:
  - OpenRouter API ([Get Key Here](https://openrouter.ai/keys)) - For LLM features
  - Groq API (for transcription) ([Get Groq API Key Here](https://console.groq.com/keys))

## FFMPEG Installation

### Windows
1. Download FFMPEG from [ffmpeg.org](https://ffmpeg.org/download.html)
2. Extract the files to a location on your computer
3. Add the FFMPEG bin directory to your system's PATH environment variable

### macOS
```bash
brew install ffmpeg
```

### Linux
```bash
sudo apt update
sudo apt install ffmpeg
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/video-editor-nextjs.git
cd video-editor-nextjs
```

2. Install dependencies:
```bash
yarn install
```

3. Create a `.env.local` file in the root directory with your API keys:
```
OPENROUTER_API_KEY=your_openrouter_api_key
GROQ_API_KEY=your_groq_api_key
```

4. Start the development server:
```bash
yarn dev
```

## Usage

The application follows a step-by-step workflow, offering controls at each stage:

1. **Upload**: Select your video file to begin
2. **Silence Removal**: Configure and apply silence detection
3. **Transcription**: Generate transcriptions for your video segments
4. **AI Filtering**: Remove duplicate segments using AI

### Tips for Best Results

- Start with shorter videos (1-2 minutes) for testing
- Ensure good audio quality in your source video
- Adjust silence detection thresholds based on your video's characteristics
- Review and edit transcriptions before finalizing

## Project Structure

```
video-editor-nextjs/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   ├── components/        # React components
│   ├── services/          # Core services
│   └── styles/            # Styling
├── components/            # Shared components
├── lib/                   # Utility functions
└── public/               # Static assets
```

## Development

- `yarn dev` - Start development server with Turbopack
- `yarn build` - Build for production
- `yarn start` - Start production server
- `yarn lint` - Run linting

## Contributing

This is an open-source project. Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Project inspired by [YouTube Tutorial](https://www.youtube.com/watch?v=u-zCSZy81eo)
- Evolved from [Follow-up Video](https://youtu.be/iQ3qyEet3HM)
- Built with [Cursor](https://cursor.sh) AI assistance

## Community

Join the AI Forge community for detailed tutorials and updates:
[The AI Forge](https://www.skool.com/the-ai-forge)
