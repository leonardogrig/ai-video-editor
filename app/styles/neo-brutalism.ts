export const neoBrutalismStyles = `
  .neo-brutalism-container {
    background-color: #f0e7db;
    color: #0a0a0a;
  }
  .neo-brutalism-card {
    border: 2px solid #0a0a0a;
    border-radius: 0;
    box-shadow: 4px 4px 0px #0a0a0a;
    background-color: #ffffff;
    transition: box-shadow 0.2s ease-in-out, transform 0.2s ease-in-out;
  }
  .neo-brutalism-card:hover {
    box-shadow: 6px 6px 0px #0a0a0a;
    transform: translate(-1px, -1px);
  }
  .neo-brutalism-button {
    border: 2px solid #0a0a0a;
    border-radius: 0;
    box-shadow: 2px 2px 0px #0a0a0a;
    font-weight: 600;
    background-color: #ffd700;
    color: #0a0a0a;
    transition: box-shadow 0.2s ease-in-out, transform 0.2s ease-in-out, background-color 0.2s ease-in-out;
  }
  .neo-brutalism-button:hover {
    background-color: #e6c300;
    box-shadow: 3px 3px 0px #0a0a0a;
    transform: translate(-1px, -1px);
  }
  .neo-brutalism-button:active {
    box-shadow: 1px 1px 0px #0a0a0a;
    transform: translate(1px, 1px);
  }
  .neo-brutalism-input {
    border: 2px solid #0a0a0a;
    border-radius: 0;
    box-shadow: inset 2px 2px 0px rgba(0,0,0,0.1);
    background-color: #ffffff;
  }
  .neo-brutalism-dialog-content {
    border: 2px solid #0a0a0a;
    border-radius: 0;
    box-shadow: 6px 6px 0px #0a0a0a;
    background-color: #ffffff;
  }
  .json-viewer-theme {
    border: 1px solid #ccc;
    padding: 10px;
    max-height: 400px;
    overflow: auto;
    font-family: monospace;
    background-color: #f9f9f9;
  }
  .parameter-control {
    margin-bottom: 16px;
  }
  .parameter-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .parameter-value {
    font-weight: bold;
    margin-left: auto;
  }
`; 