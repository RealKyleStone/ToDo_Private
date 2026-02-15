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

### Dark / Light Theme
Toggle between light and dark modes. Your preference is remembered.

## Getting Started

1. Open `index.html` in any modern browser
2. That's it. No build step, no dependencies, no installation.

## Data & Backup

Your data lives in `localStorage` in your browser. To protect against data loss:

- Use the **Export** button regularly to save a `.json` backup
- Use the **Import** button to restore from a backup or transfer to another device/browser

## Tech Stack

- **Zero dependencies** — pure HTML, CSS, and JavaScript in a single file
- **No build tools** — no Node.js, no npm, no bundler
- **No server required** — works offline, works from your filesystem
