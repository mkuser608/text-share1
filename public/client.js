// Using skypack.dev which handles all dependencies automatically
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, rectangularSelection, highlightActiveLine, keymap } from 'https://cdn.skypack.dev/@codemirror/view@6.23.0';
import { EditorState } from 'https://cdn.skypack.dev/@codemirror/state@6.4.0';
import { defaultKeymap, history, historyKeymap } from 'https://cdn.skypack.dev/@codemirror/commands@6.3.3';
import * as Y from 'https://cdn.skypack.dev/yjs@13.6.10';

// Get document key from URL
const path = window.location.pathname;
const documentKey = path === '/' ? 'default' : path.substring(1);

// Display document key
document.getElementById('documentKey').textContent = `/${documentKey}`;

// Yjs document
const ydoc = new Y.Doc();
const ytext = ydoc.getText('codemirror');

// WebSocket connection
let ws = null;
let isAuthenticated = false;
let editor = null;
let isApplyingRemoteUpdate = false;

// Initialize WebSocket connection
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    updateConnectionStatus('Connected', 'text-green-500');
    ws.send(JSON.stringify({ type: 'join', key: documentKey }));
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'needsPasswordSetup') {
      showPasswordModal(true);
    } else if (data.type === 'needsPassword') {
      showPasswordModal(false);
    } else if (data.type === 'authenticated') {
      isAuthenticated = true;
      hidePasswordModal();
      enableEditor();
      // Initialize editor after authentication
      if (!editor) {
        initEditor();
      }
    } else if (data.type === 'sync') {
      // Apply initial sync
      if (data.update && data.update.length > 0) {
        isApplyingRemoteUpdate = true;
        try {
          const update = new Uint8Array(data.update);
          Y.applyUpdate(ydoc, update);
        } catch (err) {
          console.error('Error applying sync update:', err);
        } finally {
          isApplyingRemoteUpdate = false;
        }
      }
      // Initialize editor after initial sync
      if (!editor) {
        initEditor();
      }
    } else if (data.type === 'update') {
      // Apply updates from other clients
      if (data.update && data.update.length > 0) {
        isApplyingRemoteUpdate = true;
        try {
          const update = new Uint8Array(data.update);
          Y.applyUpdate(ydoc, update);
        } catch (err) {
          console.error('Error applying update:', err);
        } finally {
          isApplyingRemoteUpdate = false;
        }
      }
    } else if (data.type === 'userCount') {
      updateUserCount(data.count);
    } else if (data.type === 'error') {
      showPasswordError(data.message);
    }
  };

  ws.onclose = () => {
    updateConnectionStatus('Disconnected', 'text-red-500');
    isAuthenticated = false;
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateConnectionStatus('Error', 'text-red-500');
  };
}

// Show password modal
function showPasswordModal(isSetup) {
  const modal = document.getElementById('passwordModal');
  const title = document.getElementById('modalTitle');
  const description = document.getElementById('modalDescription');
  const input = document.getElementById('passwordInput');

  if (isSetup) {
    title.textContent = 'Set Password';
    description.textContent = 'You are the first user. Please set a password for this document.';
  } else {
    title.textContent = 'Enter Password';
    description.textContent = 'This document is password protected.';
  }

  input.value = '';
  document.getElementById('passwordError').classList.add('hidden');
  modal.classList.remove('hidden');
  input.focus();
}

// Hide password modal
function hidePasswordModal() {
  document.getElementById('passwordModal').classList.add('hidden');
}

// Show password error
function showPasswordError(message) {
  const errorEl = document.getElementById('passwordError');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

// Update user count
function updateUserCount(count) {
  const userCountEl = document.getElementById('userCount');
  if (userCountEl) {
    userCountEl.textContent = `${count} user${count !== 1 ? 's' : ''} connected`;
  }
}

// Handle password submission
document.getElementById('passwordSubmit').addEventListener('click', () => {
  const password = document.getElementById('passwordInput').value;
  if (!password) {
    showPasswordError('Password cannot be empty');
    return;
  }

  const modalTitle = document.getElementById('modalTitle').textContent;
  if (modalTitle === 'Set Password') {
    ws.send(JSON.stringify({ type: 'setupPassword', password }));
  } else {
    ws.send(JSON.stringify({ type: 'verifyPassword', password }));
  }
});

// Handle Enter key in password input
document.getElementById('passwordInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('passwordSubmit').click();
  }
});

// Update connection status
function updateConnectionStatus(status, className) {
  const statusEl = document.getElementById('connectionStatus');
  statusEl.textContent = status;
  statusEl.className = `text-sm ${className}`;
}

// Sync Yjs text to CodeMirror
ytext.observe(() => {
  if (isApplyingRemoteUpdate && editor) {
    // Update CodeMirror to match Yjs state
    const newText = ytext.toString();
    const currentText = editor.state.doc.toString();

    if (newText !== currentText) {
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: newText
        }
      });
    }
  }
});

// Initialize CodeMirror editor
function initEditor() {
  if (editor) return; // Already initialized

  try {
    console.log('🚀 Initializing editor...');

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        rectangularSelection(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isApplyingRemoteUpdate) {
            // Sync CodeMirror changes to Yjs
            const newText = update.state.doc.toString();
            const ytextValue = ytext.toString();

            if (newText !== ytextValue) {
              ydoc.transact(() => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, newText);
              });
            }
          }
        })
      ]
    });

    editor = new EditorView({
      state,
      parent: document.getElementById('editor')
    });

    console.log('✅ Editor initialized successfully!');
    console.log('📝 You can now start typing...');

    // Focus the editor automatically
    setTimeout(() => {
      editor.focus();
    }, 100);
  } catch (error) {
    console.error('❌ Error initializing editor:', error);

    // Show a user-friendly error message
    const editorDiv = document.getElementById('editor');
    editorDiv.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <h2 style="color: #e53e3e; margin-bottom: 16px;">Failed to load editor</h2>
        <p style="color: #4a5568; margin-bottom: 16px;">There was an error loading the text editor.</p>
        <button
          onclick="location.reload()"
          style="background: #4299e1; color: white; padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px;"
        >
          Reload Page
        </button>
        <p style="color: #a0aec0; margin-top: 16px; font-size: 14px;">Error: ${error.message}</p>
      </div>
    `;
  }
}

// Enable editor controls
function enableEditor() {
  document.getElementById('saveButton').disabled = false;
}

// Handle save button
document.getElementById('saveButton').addEventListener('click', () => {
  const saveStatus = document.getElementById('saveStatus');
  saveStatus.textContent = 'Saved';
  saveStatus.className = 'text-sm text-green-500';

  setTimeout(() => {
    saveStatus.textContent = '';
  }, 2000);
});

// Listen for document updates and send to server
ydoc.on('update', (update) => {
  // Don't send updates that came from the server
  if (isApplyingRemoteUpdate) return;

  if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
    ws.send(JSON.stringify({
      type: 'update',
      update: Array.from(update)
    }));
  }
});

// Initialize
initWebSocket();
