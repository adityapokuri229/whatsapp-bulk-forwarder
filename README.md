# WhatsApp Bulk Forwarder & Dispatcher

A robust, modern web application powered by **Baileys** (`@whiskeysockets/baileys`), **Express**, and **Socket.io** designed for bulk forwarding received/sent WhatsApp messages and broadcasting formatted custom text announcements with anti-ban protections.

![License](https://img.shields.io/badge/license-ISC-emerald.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)
![WhatsApp Web](https://img.shields.io/badge/protocol-Baileys-teal.svg)

---

## Key Features

- **Baileys Multi-File Session Persistence**: Uses `useMultiFileAuthState` to save credentials locally in `auth_info_baileys/`. Once linked, your session survives restarts without scanning the QR code repeatedly.
- **In-Browser & Terminal QR Code**: Instant QR code rendering with live countdown directly on the web dashboard or as ASCII art in your terminal logs.
- **Native WhatsApp Forwarding**: Select any incoming or outgoing message from recent chats and forward it preserving WhatsApp's official forward indicators.
- **Custom Broadcast with WhatsApp Formatting**: Full support for WhatsApp styling (`*bold*`, `_italic_`, `~strikethrough~`, ````monospace````, `> quotes`, and lists) along with a **live WhatsApp bubble preview**.
- **Anti-Ban Throttling Control**: Built-in adjustable delay slider (1s to 15s) between message dispatches to safeguard phone numbers against spam detection and rate limits.
- **Live Dispatch Monitor**: Real-time progress bar, delivery logs, sent/failed metrics, and one-click task cancellation via WebSockets.

---

## Architecture Overview

```
Frontend (Tailwind + Socket.io) <---> Local Node.js Express (:3000) <---> Baileys Socket Engine <== Encrypted WebSockets ==> WhatsApp Web Servers
                                                                                |
                                                                        auth_info_baileys/ (Multi-File Auth Persistence)
```

1. **Baileys WebSocket Engine (`whatsapp.js`)**: Connects directly to WhatsApp Web's end-to-end encrypted protocol, manages session states, listens for messages, and forwards payloads.
2. **Session Persistence**: Stores cryptographic pre-keys and login credentials under `auth_info_baileys/creds.json`.
3. **Controlled Dispatcher**: Sequential queue that normalizes phone numbers (stripping invalid characters and formatting international country codes) and throttles dispatches.
4. **Real-time Web UI (`public/index.html`)**: Interactive dashboard for selecting messages, pasting target contacts, previewing dispatches, and monitoring progress.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/adityapokuri229/whatsapp-bulk-forwarder.git
   cd whatsapp-bulk-forwarder
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

1. Start the server:
   ```bash
   npm start
   ```

2. Open your web browser and navigate to:
   ```
   http://localhost:3000
   ```

3. Scan the QR code shown on the screen with WhatsApp on your phone (**Linked Devices** > **Link a Device**).

4. Once connected:
   - Choose **Forward Message** to pick from recent chat messages or **Custom Text** to compose a new broadcast.
   - Enter your target phone numbers (line-separated or comma-separated with country codes).
   - Adjust your desired throttle delay.
   - Click **Launch Bulk Forward**.

---

## Safety & Rate Limiting Guidelines

When broadcasting to multiple contacts:
- Use delays of **3 seconds or more** between dispatches.
- Avoid sending unsolicited bulk messages to unknown numbers to prevent WhatsApp anti-spam bans.

---

## License

ISC License.
