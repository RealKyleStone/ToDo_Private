# 📋 ToDo List

A simple, private, and powerful todo list app that runs entirely in your browser.

## Philosophy

**Simplicity first.** No accounts, no servers, no databases. Just open the file and start organizing your life. Your data stays on your device — always.

**Privacy by design.** All data is stored in your browser's localStorage. Nothing is ever sent to a server. No tracking, no analytics, no cookies. You own your data completely.

## Features

### Life Sections
Organize todos into customizable tabs representing different areas of your life (Work, Personal, Health, Finance, Learning, etc.). Add, rename, delete, and switch between sections freely.

### Todos & Sub-items
- Add todo items with **priority levels** (High / Medium / Low) and optional **due dates**
- Break todos into **sub-items** with individual checkboxes
- **Progress bars** auto-calculate from sub-item completion
- **Overdue detection** highlights past-due items in red
- **Inline editing** — double-click any todo or sub-item text to edit in place

### Drag & Drop
Reorder both todos and sub-items by dragging them to the position you want.

### Completed Tab
Completed items move to a dedicated Completed tab, organized by life section with completion dates. Restore any item back to its original section with one click.

### Search
Full-text search across all todos, sub-items, and completed items with highlighted matches.

### Export & Import
- **Export** your entire todo list as a JSON backup file
- **Import** a backup to restore or transfer data — choose to merge with existing data or replace it entirely

### Folder Sync (Cross-Device)
Optionally sync your todos to a local folder using the browser's File System Access API. Pair it with a cloud-synced folder to access your data across devices — no sign-in required.

- Works with **Google Drive**, **OneDrive**, **Dropbox**, **iCloud**, or any folder that syncs to the cloud
- No accounts, API keys, or server setup needed
- Your data is just a JSON file in a folder you control
- Requires **Chrome** or **Edge** (File System Access API is not supported in Firefox/Safari)

### Dark / Light Theme
Toggle between light and dark modes. Your preference is remembered.

## Getting Started

1. Open `index.html` in any modern browser
2. That's it. No build step, no dependencies, no installation.

## Data & Backup

Your data lives in `localStorage` in your browser. To protect against data loss:

- Use the **Export** button regularly to save a `.json` backup
- Use the **Import** button to restore from a backup or transfer to another device/browser

### Cross-Device Sync Setup

To sync your todos across multiple devices:

1. Install a cloud sync desktop app ([Google Drive](https://www.google.com/drive/download/), [OneDrive](https://www.microsoft.com/en-us/microsoft-365/onedrive/download), or [Dropbox](https://www.dropbox.com/install))
2. Open the ToDo app in **Chrome** or **Edge**
3. Click the **📁 Sync** button in the header
4. Click **"Choose Folder"** and select a folder inside your synced drive
5. Your todos will auto-save to that folder whenever you make changes
6. On another device, repeat steps 1-4 and pick the same synced folder
7. Click **"Sync Now"** to pull the latest data from the folder

> **Note:** The File System Access API is only available in Chromium-based browsers (Chrome, Edge). The sync feature will not appear in Firefox or Safari.

## Tech Stack

- **Zero dependencies** — pure HTML, CSS, and JavaScript in a single file
- **No build tools** — no Node.js, no npm, no bundler
- **No server required** — works offline, works from your filesystem
