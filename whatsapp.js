import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  proto
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

export class WhatsAppClient {
  constructor(io, authDir = './auth_info_baileys') {
    this.io = io;
    this.authDir = authDir;
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrCodeDataUrl = null;
    this.userInfo = null;
    this.recentMessages = []; // stores last 100 messages for forwarding
    this.activeTask = null; // for queue tracking
  }

  emitState() {
    this.io.emit('status_update', {
      status: this.status,
      qr: this.qrCodeDataUrl,
      user: this.userInfo,
      recentMessagesCount: this.recentMessages.length
    });
  }

  async init() {
    try {
      this.status = 'connecting';
      this.emitState();

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`Using Baileys version ${version.join('.')}, isLatest: ${isLatest}`);

      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['BulkForwarder', 'Chrome', '1.0.0'],
        syncFullHistory: false
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { scale: 8, margin: 2 });
            this.status = 'qr_ready';
            console.log('\n--- Scan WhatsApp QR Code Below or visit http://localhost:3000 ---');
            qrcodeTerminal.generate(qr, { small: true });
            this.emitState();
          } catch (err) {
            console.error('Failed to generate QR data URL:', err);
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.qrCodeDataUrl = null;
          const user = this.sock.user;
          this.userInfo = {
            id: user?.id,
            name: user?.name || user?.notify || 'WhatsApp User',
            phone: user?.id?.split(':')[0]?.replace('@s.whatsapp.net', '')
          };
          console.log(`WhatsApp connected successfully as: ${this.userInfo.phone} (${this.userInfo.name})`);
          this.emitState();
          this.io.emit('log', { type: 'success', text: `Connected as ${this.userInfo.phone}` });
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          console.log(`Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
          this.status = 'disconnected';
          this.userInfo = null;
          this.emitState();

          if (shouldReconnect) {
            setTimeout(() => this.init(), 3000);
          } else {
            console.log('Logged out. Clearing auth credentials.');
            this.clearAuth();
          }
        }
      });

      // Capture messages for forwarding selection
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const msg of messages) {
          if (!msg.message) continue;
          
          // Extract text preview
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            (msg.message.imageMessage ? '[Image]' : null) ||
            (msg.message.documentMessage ? `[Doc: ${msg.message.documentMessage.fileName || 'file'}]` : null) ||
            (msg.message.audioMessage ? '[Audio]' : null) ||
            '[Message]';

          const remoteJid = msg.key.remoteJid || '';
          const sender = msg.pushName || (msg.key.fromMe ? 'You' : remoteJid.replace('@s.whatsapp.net', ''));

          const messageEntry = {
            id: msg.key.id,
            remoteJid,
            fromMe: msg.key.fromMe,
            sender,
            text,
            timestamp: Number(msg.messageTimestamp) * 1000 || Date.now(),
            raw: msg
          };

          // Check if already in list
          const exists = this.recentMessages.find(m => m.id === messageEntry.id);
          if (!exists) {
            this.recentMessages.unshift(messageEntry);
            if (this.recentMessages.length > 80) {
              this.recentMessages.pop();
            }
          }
        }
        this.io.emit('recent_messages', this.getFormattedRecentMessages());
      });

    } catch (error) {
      console.error('Error initializing WhatsApp socket:', error);
      this.status = 'disconnected';
      this.emitState();
    }
  }

  getFormattedRecentMessages() {
    return this.recentMessages.map(m => ({
      id: m.id,
      remoteJid: m.remoteJid,
      fromMe: m.fromMe,
      sender: m.sender,
      text: m.text,
      timestamp: m.timestamp
    }));
  }

  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {
      console.error('Logout error:', e);
    }
    this.clearAuth();
    this.status = 'disconnected';
    this.userInfo = null;
    this.qrCodeDataUrl = null;
    this.emitState();
    setTimeout(() => this.init(), 1000);
  }

  clearAuth() {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
        console.log('Cleared auth directory:', this.authDir);
      }
    } catch (err) {
      console.error('Failed to clear auth dir:', err);
    }
  }

  normalizeJid(target) {
    let clean = target.trim();
    if (!clean) return null;
    if (clean.endsWith('@s.whatsapp.net') || clean.endsWith('@g.us')) {
      return clean;
    }
    // Remove +, spaces, hyphens
    const digitsOnly = clean.replace(/\D/g, '');
    if (digitsOnly.length < 6) return null;
    return `${digitsOnly}@s.whatsapp.net`;
  }

  cancelActiveTask() {
    if (this.activeTask) {
      this.activeTask.cancelled = true;
      return true;
    }
    return false;
  }

  async startBulkForward({ recipients, mode, messageId, customText, delayMs = 3000 }) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp socket is not connected');
    }

    if (this.activeTask && !this.activeTask.completed) {
      throw new Error('A bulk dispatch is already running');
    }

    // Format recipients
    const cleanRecipients = recipients
      .map(r => this.normalizeJid(r))
      .filter((r, idx, arr) => r && arr.indexOf(r) === idx);

    if (cleanRecipients.length === 0) {
      throw new Error('No valid recipients provided');
    }

    let forwardTarget = null;
    if (mode === 'forward') {
      const found = this.recentMessages.find(m => m.id === messageId);
      if (!found) {
        throw new Error('Selected message to forward was not found in cache');
      }
      forwardTarget = found.raw;
    } else if (mode === 'custom') {
      if (!customText || !customText.trim()) {
        throw new Error('Custom message content is empty');
      }
    } else {
      throw new Error(`Unsupported mode: ${mode}`);
    }

    const task = {
      id: Date.now().toString(),
      total: cleanRecipients.length,
      current: 0,
      successful: 0,
      failed: 0,
      cancelled: false,
      completed: false,
      startTime: Date.now()
    };

    this.activeTask = task;
    this.io.emit('bulk_progress', { ...task, percent: 0 });

    // Run async loop in background
    (async () => {
      for (let i = 0; i < cleanRecipients.length; i++) {
        if (task.cancelled) {
          this.io.emit('log', { type: 'warning', text: 'Bulk forwarding cancelled by user.' });
          break;
        }

        const jid = cleanRecipients[i];
        task.current = i + 1;
        const phoneLabel = jid.replace('@s.whatsapp.net', '');

        try {
          if (mode === 'forward') {
            await this.sock.sendMessage(jid, {
              forward: forwardTarget,
              force: true
            });
          } else {
            await this.sock.sendMessage(jid, {
              text: customText
            });
          }

          task.successful++;
          this.io.emit('log', {
            type: 'success',
            text: `[${task.current}/${task.total}] Successfully sent to ${phoneLabel}`
          });
        } catch (err) {
          task.failed++;
          console.error(`Error sending to ${jid}:`, err);
          this.io.emit('log', {
            type: 'error',
            text: `[${task.current}/${task.total}] Failed sending to ${phoneLabel}: ${err.message || err}`
          });
        }

        const percent = Math.round((task.current / task.total) * 100);
        this.io.emit('bulk_progress', { ...task, percent });

        // Delay between sends to avoid rate-limiting
        if (i < cleanRecipients.length - 1 && !task.cancelled) {
          await new Promise(resolve => setTimeout(resolve, Math.max(1000, Number(delayMs) || 3000)));
        }
      }

      task.completed = true;
      this.io.emit('bulk_complete', {
        ...task,
        durationSeconds: Math.round((Date.now() - task.startTime) / 1000)
      });
    })();

    return { taskId: task.id, total: task.total };
  }
}
