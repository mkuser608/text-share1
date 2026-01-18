const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Y = require('yjs');
const bcrypt = require('bcrypt');

const PORT = process.env.PORT || 3000;

// In-memory storage for documents
const documents = new Map();

// HTTP Server
const server = http.createServer((req, res) => {
  const url = req.url;

  // Serve static files
  if (url === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    fs.readFile(path.join(__dirname, 'public', 'client.js'), (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.end(data);
    });
    return;
  }

  // Serve main HTML for any other path
  res.writeHead(200, { 'Content-Type': 'text/html' });
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Server error');
      return;
    }
    res.end(data);
  });
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

// Broadcast user count to all clients in a document
function broadcastUserCount(key) {
  const doc = documents.get(key);
  if (doc) {
    const count = doc.connectedClients.size;
    doc.connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'userCount', count }));
      }
    });
  }
}

wss.on('connection', (ws, req) => {
  let currentKey = null;
  let isAuthenticated = false;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Handle document join request
      if (data.type === 'join') {
        currentKey = data.key;

        if (!documents.has(currentKey)) {
          // New document - needs password setup
          ws.send(JSON.stringify({ type: 'needsPasswordSetup' }));
        } else {
          // Existing document - needs password verification
          ws.send(JSON.stringify({ type: 'needsPassword' }));
        }
      }

      // Handle password setup (first user)
      else if (data.type === 'setupPassword') {
        if (!documents.has(currentKey)) {
          const passwordHash = await bcrypt.hash(data.password, 10);
          const ydoc = new Y.Doc();

          documents.set(currentKey, {
            ydoc,
            passwordHash,
            connectedClients: new Set()
          });

          isAuthenticated = true;
          documents.get(currentKey).connectedClients.add(ws);
          ws.send(JSON.stringify({ type: 'authenticated' }));

          // Send initial document state
          const update = Y.encodeStateAsUpdate(ydoc);
          ws.send(JSON.stringify({
            type: 'sync',
            update: Array.from(update)
          }));

          // Broadcast updated user count
          broadcastUserCount(currentKey);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Document already exists' }));
        }
      }

      // Handle password verification
      else if (data.type === 'verifyPassword') {
        const doc = documents.get(currentKey);
        if (doc) {
          const match = await bcrypt.compare(data.password, doc.passwordHash);
          if (match) {
            isAuthenticated = true;
            doc.connectedClients.add(ws);
            ws.send(JSON.stringify({ type: 'authenticated' }));

            // Send current document state
            const update = Y.encodeStateAsUpdate(doc.ydoc);
            ws.send(JSON.stringify({
              type: 'sync',
              update: Array.from(update)
            }));

            // Broadcast updated user count
            broadcastUserCount(currentKey);
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid password' }));
          }
        }
      }

      // Handle Yjs updates
      else if (data.type === 'update' && isAuthenticated) {
        const doc = documents.get(currentKey);
        if (doc) {
          const update = new Uint8Array(data.update);
          Y.applyUpdate(doc.ydoc, update);

          // Broadcast to all other connected clients
          doc.connectedClients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'update',
                update: data.update
              }));
            }
          });
        }
      }

      // Handle awareness updates (cursors/selections)
      else if (data.type === 'awareness' && isAuthenticated) {
        const doc = documents.get(currentKey);
        if (doc) {
          // Broadcast awareness to all other clients
          doc.connectedClients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'awareness',
                awareness: data.awareness
              }));
            }
          });
        }
      }

    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Server error' }));
    }
  });

  ws.on('close', () => {
    if (currentKey && documents.has(currentKey)) {
      documents.get(currentKey).connectedClients.delete(ws);
      // Broadcast updated user count
      broadcastUserCount(currentKey);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
