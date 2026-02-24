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
let sharedFiles = new Map(); // Store shared files

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
      // Request file list after authentication
      requestFileList();
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
    } else if (data.type === 'fileList') {
      // Receive list of existing files
      data.files.forEach(file => {
        sharedFiles.set(file.id, file);
        addFileToUI(file);
      });
    } else if (data.type === 'fileAdded') {
      // New file added
      sharedFiles.set(data.file.id, data.file);
      addFileToUI(data.file);
    } else if (data.type === 'fileDeleted') {
      // File deleted
      sharedFiles.delete(data.fileId);
      removeFileFromUI(data.fileId);
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

// File handling functions
function addFileToUI(file) {
  const fileList = document.getElementById('fileList');

  // Remove "no files" message if it exists
  const noFilesMsg = fileList.querySelector('p');
  if (noFilesMsg) {
    noFilesMsg.remove();
  }

  // Check if file already exists in UI
  if (document.getElementById(`file-${file.id}`)) {
    return;
  }

  const fileElement = document.createElement('div');
  fileElement.id = `file-${file.id}`;
  fileElement.className = 'bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md transition';

  const fileSize = formatFileSize(file.size);
  const fileIcon = getFileIcon(file.type);

  fileElement.innerHTML = `
    <div class="flex items-start justify-between">
      <div class="flex items-start gap-2 flex-1 min-w-0">
        <div class="text-2xl">${fileIcon}</div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-800 truncate" title="${file.name}">${file.name}</p>
          <p class="text-xs text-gray-500">${fileSize}</p>
        </div>
      </div>
      <div class="flex gap-1 ml-2">
        <button
          onclick="downloadFile('${file.id}')"
          class="p-1.5 hover:bg-blue-50 rounded transition"
          title="Download"
        >
          <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
          </svg>
        </button>
        <button
          onclick="deleteFile('${file.id}')"
          class="p-1.5 hover:bg-red-50 rounded transition"
          title="Delete"
        >
          <svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
          </svg>
        </button>
      </div>
    </div>
  `;

  fileList.appendChild(fileElement);
}

function removeFileFromUI(fileId) {
  const fileElement = document.getElementById(`file-${fileId}`);
  if (fileElement) {
    fileElement.remove();
  }

  // Show "no files" message if list is empty
  const fileList = document.getElementById('fileList');
  if (fileList.children.length === 0) {
    fileList.innerHTML = '<p class="text-gray-400 text-sm text-center mt-8">No files shared yet</p>';
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function getFileIcon(mimeType) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎥';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return '📦';
  if (mimeType.includes('text/')) return '📝';
  if (mimeType.includes('word')) return '📘';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📙';
  return '📎';
}

// Make functions global for onclick handlers
window.downloadFile = function(fileId) {
  const file = sharedFiles.get(fileId);
  if (!file) return;

  // Convert base64 to blob
  const byteCharacters = atob(file.data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: file.type });

  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

window.deleteFile = function(fileId) {
  if (confirm('Are you sure you want to delete this file?')) {
    if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
      ws.send(JSON.stringify({
        type: 'deleteFile',
        fileId: fileId
      }));
    }
  }
};

// Handle file upload
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);

  for (const file of files) {
    // Limit file size to 10MB
    if (file.size > 10 * 1024 * 1024) {
      alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
      continue;
    }

    // Read file as base64
    const reader = new FileReader();
    reader.onload = function(event) {
      const base64Data = event.target.result.split(',')[1];

      if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
        ws.send(JSON.stringify({
          type: 'uploadFile',
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          data: base64Data
        }));
      }
    };
    reader.readAsDataURL(file);
  }

  // Clear input
  e.target.value = '';
});

// Request files after authentication
function requestFileList() {
  if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
    ws.send(JSON.stringify({ type: 'requestFiles' }));
  }
}

// Initialize
initWebSocket();
