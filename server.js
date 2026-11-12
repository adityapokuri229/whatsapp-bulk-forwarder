import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WhatsAppClient } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECIPIENTS_FILE = path.join(__dirname, 'recipients.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize WhatsApp Client
const waClient = new WhatsAppClient(io, path.join(__dirname, 'auth_info_baileys'));

// Socket.io real-time connection
io.on('connection', (socket) => {
  console.log(`Web client connected (${socket.id})`);
  
  // Send initial state immediately
  socket.emit('status_update', {
    status: waClient.status,
    qr: waClient.qrCodeDataUrl,
    user: waClient.userInfo,
    recentMessagesCount: waClient.recentMessages.length
  });

  socket.emit('recent_messages', waClient.getFormattedRecentMessages());

  socket.on('request_status', () => {
    waClient.emitState();
  });

  socket.on('cancel_bulk', () => {
    const cancelled = waClient.cancelActiveTask();
    socket.emit('log', {
      type: cancelled ? 'warning' : 'info',
      text: cancelled ? 'Bulk task cancelled.' : 'No active task running.'
    });
  });

  socket.on('reconnect_wa', () => {
    waClient.init();
  });

  socket.on('logout_wa', async () => {
    await waClient.logout();
  });
});

// REST API routes
app.get('/api/status', (req, res) => {
  res.json({
    status: waClient.status,
    qr: waClient.qrCodeDataUrl,
    user: waClient.userInfo,
    recentCount: waClient.recentMessages.length
  });
});

app.get('/api/messages', (req, res) => {
  res.json(waClient.getFormattedRecentMessages());
});

app.get('/api/recipients', async (req, res) => {
  try {
    if (fs.existsSync(RECIPIENTS_FILE)) {
      const data = await fs.promises.readFile(RECIPIENTS_FILE, 'utf8');
      return res.json({ text: JSON.parse(data) });
    }
  } catch (err) {
    console.error('Failed reading recipients file:', err.message);
  }
  res.json({ text: '' });
});

app.post('/api/recipients', async (req, res) => {
  try {
    const { text } = req.body;
    await fs.promises.writeFile(RECIPIENTS_FILE, JSON.stringify(text || ''), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/bulk-send', async (req, res) => {
  try {
    const { recipients, mode, messageId, customText, delayMs } = req.body;
    const result = await waClient.startBulkForward({
      recipients,
      mode,
      messageId,
      customText,
      delayMs
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/cancel', (req, res) => {
  const cancelled = waClient.cancelActiveTask();
  res.json({ success: true, cancelled });
});

app.post('/api/logout', async (req, res) => {
  await waClient.logout();
  res.json({ success: true, message: 'Logged out successfully' });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`\n==============================================`);
  console.log(` WhatsApp Bulk Forwarder running at:`);
  console.log(` http://localhost:${PORT}`);
  console.log(`==============================================\n`);
  
  // Start Baileys socket connection
  await waClient.init();
});
