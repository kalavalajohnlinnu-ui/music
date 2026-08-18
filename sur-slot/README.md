# 🎼 Sir Slot (Sur Slot) — Music Academy & Smart Booking System

A Progressive Web App (PWA) and Academy Management System for Music Coaches and Students.

> 🎬 “Music is the language of the soul” — Scheduling from 5:00 AM to 11:00 PM across 10 Studio Instruments.

---

## ✩ Features & Portals

1. **＼＾ Music Sir (Coach) Master Portal**: Chronological daily schedule (5:00 AM to 11:00 PM), attendance override, feedback/homework log, PDF generation, and WhatsApp automation.
2. ***🎓 Fixed Weekly Batch Student Portal**: Student login via Name or Mobile, upcoming batch classes, self-attendance ("Can't make it"), and smart make-up slot booking.
3. **⚡ Flexible Session Booking Portal**: Free slots discovery across Morning, Afternoon, and Evening, with 1-tap direct call/WhatsApp booking.
4. **🔔 Automated Web Push Notifications**:

   - ⏰ **1 Hour Before Alert**: Reminds Sir who is coming + prompts student to attend or mark absent.
   - 🌝 **9:00 PM Night-Before Alert**: For 5:00 AM & 6:00 AM early morning classes.
   - 🌱 **7:00 AM Morning Digest**: Daily class reminders & homework notes.
   - ⚠️ **Instant Absent Alert**: Notifies Sir immediately when a student marks "Can't make it".
   - ⚡ **Instant Booking Alert**: Notifies Sir when a flexible student requests a slot.
5. **🎸 PDF Progress Reports**: 1-click auto-generated student attendance & evaluation pdf certificates.
6. ***🐹 PGA Installable**: Standalone app for iOS Safari (16.4+) and Android Chrome.

---

## 📦 Files to Commit to GitHub

| Filename | Description |
| :--- | :--- |
| `index.html` | Main frontend PWA app (single-file*exclusive ui) |
| `server.js` | Node.js backend with SQLite, Web Push encryption & Scheduler |
| `sw.js` | Service Worker for offline caching & Web Push events |
| `manifest.json` | PWA Manifest with standalone description & themes |
| `cloudflare-worker.js` | Cloudflare Worker Web Push Backend (aes128gcm + VAPID) |
| `weurler.toml` | Cloudflare Worker deployment config |
| `icon-192.png` | PWA app icon (192x192) |
| `icon-512.png` | PWA app icon (512x512) |
| `icon.svg` | Vector MVG Luxury Icon |
| `package.json` | Node.js project definition |
| `.gitignore` | Git ignore for local databases & secrets |
| `README.md` | Project documentation |

---

## 🚀 Local Setup & Running

```bash
# 1. Install / clone repo
git clone https://github.com/your-username/sir-slot.git
Z��� sir-slot

# 2. Start the backend server
node server.js

# 3. Open in browser
# http://localhost:3000
```

---

## 🎉ā��������ձ�̀��!��������(��1�����A%8聀���р(��Aɥ���������5�����聀���������Հ(��M�������������5�����聀���������р