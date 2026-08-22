# 🎼 Thomas International Music Academy (TIMA) — Music Studio Management System

A Progressive Web App (PWA) and Studio Management System engineered for Music Coaches, Students, and Parents.

> **Studio Timings**: 5:00 AM to 11:00 PM  
> **Instruments Taught (9 Studio Instruments)**: Keyboard, Guitar, Flute, Violin, Octapad & Rhythm Pads, Recorder, Harmonica, Ukulele, Melodica (Tabla excluded).  
> **Theme**: Sky Blue & Oceanic Slate on Porcelain (`#F0F7FF`).  
> **Motto**: *"Sing and make music from your heart to the Lord."* — Ephesians 5:19

---

## 🌟 Core Features & Portals

1. **👨‍🏫 Music Coach Master Portal (Thomas Sir)**:
   - **Chronological Class Schedule**: Real-time slots from 5:00 AM to 11:00 PM with student avatars and attendance indicators.
   - **Multi-Avatar Group System**: Automatic dual/trio circular cluster avatars for sibling duos, trios, and groups.
   - **Touch & Mouse Avatar Repositioner**: Interactive 1:1 square crop with pan & zoom (1.0x to 3.0x).
   - **Student Roster & Search**: Segmented filters (`Today`, `All`, `Regular`, `Flexible`, `Solo`, `Groups`).
   - **Attendance & Evaluations**: 1-click attendance marking, homework & performance logs, monthly attendance rate calculations.
   - **Automated Unmarked Attendance Alarms**: Sound & visual alerts when classes conclude without attendance marking.
   - **Zero-Error Data Backup & Restore**: 1-click JSON and SQLite `.db` downloads, automated pre-reset emergency snapshots, and ACID transactional restore.

2. **🎓 Student & Parent Portal (Self-Service)**:
   - Login via registered 10-digit mobile number and PIN.
   - Profile avatar with direct camera selfie upload & compression.
   - Live schedule, upcoming classes, lesson progress, and performance notes.
   - 1-click self-attendance marking (*"Can't make it"*) with instant make-up slot booking.

3. **⚡ Flexible & Make-Up Slot Booking**:
   - Live discovery of open class slots across Morning (5 AM–12 PM), Afternoon (12 PM–5 PM), and Evening (5 PM–11 PM).
   - Instant reservation with automated coach notifications.

4. **📱 PWA & Push Notifications**:
   - Installable on iOS Safari and Android Chrome as a native app with custom icons and splash screens.
   - Offline fallback screen with auto-reconnection.

---

## 📁 Repository & Project Structure

| File / Folder | Purpose |
| :--- | :--- |
| `index.html` | Single-file frontend PWA (Sky Blue theme, touch crop, multi-avatar clusters) |
| `server.js` | Node.js backend with built-in SQLite, encryption, scheduler, and REST API |
| `sir_slot.db` | Clean SQLite production database |
| `manifest.json` | PWA manifest configuration for mobile app installation |
| `sw.js` | Service Worker for offline caching and web push notifications |
| `package.json` | Project configuration (`node >= 22.5.0`, zero external npm dependencies) |
| `.gitignore` | Git ignore rules |
| `.nvmrc` | Node version configuration (`22`) |
| `cloudflare-worker.js`| Cloudflare Worker Web Push backend (optional for edge hosting) |
| `itma-logo.png` | Official high-resolution circular Academy Logo |
| `icon-192.png` / `icon-512.png` | Mobile PWA app icons |
| `favicon.ico` / `favicon.png` | Browser tab favicons |
| `alarm.mp3` | Unmarked attendance sound alert |
| `offline.html` | Offline fallback page |
| `*.pdf` | Official User & Technical Documentation Guides |

---

## 🚀 Quickstart & Local Setup

```bash
# 1. Ensure Node.js >= 22.5.0 is installed
node -v

# 2. Start the application (No npm install needed!)
node server.js

# 3. Open in your browser
http://localhost:3000/
```

- **Coach Portal PIN**: Default is `1990` (Can be customized anytime in Settings).
