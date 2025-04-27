import React from 'react';

interface JsonViewerProps {
  data: any;
  title?: string;
}

export function JsonViewer({ data, title }: JsonViewerProps) {
  return (
    <div className="my-4">
      {title && <h3 className="text-sm font-bold mb-2">{title}</h3>}
      <pre className="bg-gray-100 p-2 rounded-md text-xs overflow-auto max-h-60">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
} 