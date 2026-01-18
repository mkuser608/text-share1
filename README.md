# Text Share - Real-time Collaborative Editor

A simple, in-memory collaborative code/markdown editor with real-time synchronization.

## Features

- Real-time collaborative editing using Yjs CRDTs
- Password-protected documents
- CodeMirror 6 editor with syntax highlighting
- Support for Markdown, JavaScript, and Python
- Multi-user cursor synchronization
- No database or persistent storage (in-memory only)

## Getting Started

### Installation

```bash
npm install
```

### Running the Server

```bash
npm start
```

The server will start on `http://localhost:3000`

## Usage

1. Navigate to `http://localhost:3000/{your-key}` (e.g., `http://localhost:3000/my-doc`)
2. If it's a new document, you'll be prompted to set a password
3. If it's an existing document, you'll need to enter the password
4. Start editing! Share the URL and password with collaborators

### Examples

- `http://localhost:3000/meeting-notes`
- `http://localhost:3000/code-review`
- `http://localhost:3000/brainstorm`

## Important Notes

- All data is stored in-memory only
- Restarting the server will delete all documents
- Refreshing the page preserves the document (until server restart)
- The "Save" button only updates UI state, it does not persist to disk

## Technology Stack

- **Backend**: Node.js with WebSocket (ws)
- **Frontend**: CodeMirror 6
- **Collaboration**: Yjs (CRDT)
- **Security**: bcrypt for password hashing
- **Styling**: Tailwind CSS

## Architecture

```
Map<key, {
  ydoc: Y.Doc,           // Yjs document
  passwordHash: string,   // bcrypt hash
  connectedClients: Set   // WebSocket connections
}>
```
