/**
 * Formats a time in seconds to a MM:SS.s format
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "00:00.0";
  
  // Calculate minutes and remaining seconds
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  // Format with leading zeros for minutes and seconds
  const minutesStr = minutes.toString().padStart(2, '0');
  const secondsStr = remainingSeconds.toFixed(1).padStart(4, '0');
  
  return `${minutesStr}:${secondsStr}`;
} 