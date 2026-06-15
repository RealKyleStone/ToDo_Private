import { Component, signal, computed, effect, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface FolderPickerPlugin {
  pickDirectory(): Promise<{ uri: string; name: string }>;
  writeFile(opt: { uri: string; filename: string; data: string }): Promise<void>;
}
const FolderPicker = registerPlugin<FolderPickerPlugin>('FolderPicker');

// ── Capacitor lazy-loaders ─────────────────────────
let CapPreferences: {
  get(opt: { key: string }): Promise<{ value: string | null }>;
  set(opt: { key: string; value: string }): Promise<void>;
} | null = null;

let CapNotifications: {
  requestPermissions(): Promise<{ display: string }>;
  checkPermissions(): Promise<{ display: string }>;
  schedule(opt: { notifications: LocalNotification[] }): Promise<void>;
  cancel(opt: { notifications: { id: number }[] }): Promise<void>;
  createChannel?(opt: NotificationChannel): Promise<void>;
} | null = null;

interface LocalNotification {
  id: number; title: string; body: string;
  schedule?: { at: Date }; channelId?: string;
}
interface NotificationChannel {
  id: string; name: string; importance: number;
}

async function loadCapacitor() {
  try {
    const mod = await import('@capacitor/preferences');
    CapPreferences = mod.Preferences;
  } catch { CapPreferences = null; }
  try {
    const mod = await import('@capacitor/local-notifications');
    CapNotifications = mod.LocalNotifications as any;
    // Create notification channel for Android
    if ((CapNotifications as any).createChannel) {
      await (CapNotifications as any).createChannel({
        id: 'todo-reminders', name: 'Todo Reminders', importance: 4,
      });
    }
  } catch { CapNotifications = null; }
}

async function storageGet(key: string): Promise<string | null> {
  if (CapPreferences) { const { value } = await CapPreferences.get({ key }); return value; }
  return localStorage.getItem(key);
}
async function storageSet(key: string, value: string): Promise<void> {
  if (CapPreferences) { await CapPreferences.set({ key, value }); }
  else { localStorage.setItem(key, value); }
}

// ── Types ──────────────────────────────────────────
export type Priority = 'high' | 'medium' | 'low';
export type SortBy = 'manual' | 'priority' | 'due-date';
export type FilterBy = 'all' | 'high' | 'medium' | 'low';
export type Theme = 'light' | 'dark';
export type ActiveView = 'todos' | 'completed' | 'stats';

interface Note { id: string; text: string; createdAt: string; }
interface SubItem { id: string; text: string; done: boolean; }
interface Todo {
  id: string; text: string; done: boolean; priority: Priority;
  dueDate: string | null; subItems: SubItem[]; notes: Note[];
  reminderEnabled: boolean;
}
interface CompletedTodo extends Todo { section: string; completedAt: string; }
interface AppState {
  sections: string[]; activeTab: string;
  todos: { [section: string]: Todo[] };
  completed: CompletedTodo[]; theme: Theme;
  notificationsEnabled: boolean;
}

// ── Sync state (not persisted) ─────────────────────
interface SyncState {
  status: 'idle' | 'connected' | 'disconnected';
  folderName: string | null;
}

const STORAGE_KEY = 'todo-native-v7';
const LONG_PRESS_MS = 500;
const SYNC_FILENAME = 'todo-sync-data.json';
const IS_NATIVE = Capacitor.isNativePlatform();
const NATIVE_SYNC_URI_KEY = 'nativeSyncUri';
const NATIVE_SYNC_NAME_KEY = 'nativeSyncName';

const DEFAULT_STATE: AppState = {
  sections: ['Work', 'Personal', 'Health', 'Finance', 'Learning'],
  activeTab: 'Work',
  todos: { Work: [], Personal: [], Health: [], Finance: [], Learning: [] },
  completed: [], theme: 'light', notificationsEnabled: false,
};

const PRIORITY_CYCLE: Record<Priority, Priority> = { high: 'medium', medium: 'low', low: 'high' };
const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  // ── State ──────────────────────────────────────────
  protected readonly state = signal<AppState>(structuredClone(DEFAULT_STATE));
  protected readonly loaded = signal(false);

  // ── Form fields ────────────────────────────────────
  protected readonly newTodoText = signal('');
  protected readonly newTodoPriority = signal<Priority>('medium');
  protected readonly newTodoDueDate = signal('');
  protected readonly newTodoReminder = signal(false);

  // ── UI state ───────────────────────────────────────
  protected readonly menuOpenFor = signal<string | null>(null);
  protected readonly subInputFor = signal<string | null>(null);
  protected readonly notesPanelFor = signal<string | null>(null);
  protected readonly newSubText = signal('');
  protected readonly newNoteText = signal('');
  protected readonly sortBy = signal<SortBy>('manual');
  protected readonly filterBy = signal<FilterBy>('all');
  protected readonly searchQuery = signal('');
  protected readonly activeView = signal<ActiveView>('todos');
  protected readonly showExportMenu = signal(false);
  protected readonly chartPeriod = signal<'daily' | 'weekly' | 'monthly'>('weekly');

  // Drag
  protected readonly dragId = signal<string | null>(null);
  protected readonly dragOverId = signal<string | null>(null);

  // Sync
  protected readonly sync = signal<SyncState>({ status: 'idle', folderName: null });
  protected readonly isNative = IS_NATIVE;
  private syncDirHandle: FileSystemDirectoryHandle | null = null;
  private syncSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Derived ───────────────────────────────────────
  protected readonly sections = computed(() => this.state().sections);
  protected readonly activeTab = computed(() => this.state().activeTab);
  protected readonly theme = computed(() => this.state().theme);
  protected readonly completedList = computed(() => this.state().completed);
  protected readonly notificationsEnabled = computed(() => this.state().notificationsEnabled);

  protected readonly currentTodos = computed(() => {
    const raw = this.state().todos[this.state().activeTab] ?? [];
    const q = this.searchQuery().toLowerCase().trim();
    const searched = q ? raw.filter(t =>
      t.text.toLowerCase().includes(q) ||
      t.subItems.some(s => s.text.toLowerCase().includes(q)) ||
      t.notes.some(n => n.text.toLowerCase().includes(q))
    ) : raw;
    const filtered = this.filterBy() === 'all' ? searched : searched.filter(t => t.priority === this.filterBy());
    const sort = this.sortBy();
    if (sort === 'manual') return filtered;
    return [...filtered].sort((a, b) => {
      if (sort === 'priority') return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1; if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  });

  protected readonly remainingCount = computed(() => this.currentTodos().filter(t => !t.done).length);
  protected readonly completedSearched = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.state().completed;
    return this.state().completed.filter(c =>
      c.text.toLowerCase().includes(q) || c.section.toLowerCase().includes(q)
    );
  });

  // ── Stats ──────────────────────────────────────────
  protected readonly statsToday = computed(() => this.countCompleted(0, 1));
  protected readonly statsWeek = computed(() => this.countCompleted(
    -new Date().getDay(), 7 - new Date().getDay()
  ));
  protected readonly statsMonth = computed(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return this.state().completed.filter(c => {
      const d = new Date(c.completedAt); return d >= start && d < end;
    }).length;
  });
  protected readonly statsTotal = computed(() => this.state().completed.length);

  protected readonly chartData = computed(() => {
    const period = this.chartPeriod();
    const buckets: { label: string; count: number }[] = [];
    const now = new Date();
    if (period === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
        const next = new Date(d); next.setDate(d.getDate() + 1);
        buckets.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), count: this.countInRange(d, next) });
      }
    } else if (period === 'weekly') {
      for (let i = 7; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - (d.getDay() + i * 7)); d.setHours(0,0,0,0);
        const next = new Date(d); next.setDate(d.getDate() + 7);
        buckets.push({ label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count: this.countInRange(d, next) });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), count: this.countInRange(d, next) });
      }
    }
    return buckets;
  });

  private countCompleted(startOffset: number, daysCount: number): number {
    const now = new Date(); now.setHours(0,0,0,0);
    const start = new Date(now); start.setDate(now.getDate() + startOffset);
    const end = new Date(start); end.setDate(start.getDate() + daysCount);
    return this.countInRange(start, end);
  }
  private countInRange(start: Date, end: Date): number {
    return this.state().completed.filter(c => {
      const d = new Date(c.completedAt); return d >= start && d < end;
    }).length;
  }

  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const s = this.state();
      if (!this.loaded()) return;
      if (this.saveTimeout) clearTimeout(this.saveTimeout);
      this.saveTimeout = setTimeout(() => {
        storageSet(STORAGE_KEY, JSON.stringify(s));
        this.debouncedSyncToFolder();
      }, 300);
    });
    effect(() => document.documentElement.setAttribute('data-theme', this.theme()));
  }

  async ngOnInit(): Promise<void> {
    await loadCapacitor();
    const raw = await storageGet(STORAGE_KEY);
    if (raw) { const p = this.parseState(raw); if (p) this.state.set(p); }
    this.loaded.set(true);
    this.tryRestoreSyncHandle();
  }

  // ── Theme ──────────────────────────────────────────
  protected toggleTheme(): void {
    this.state.update(s => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }));
  }

  // ── Notifications ──────────────────────────────────
  protected async toggleNotifications(): Promise<void> {
    if (!CapNotifications) {
      alert('Push notifications require the native app. They are not available in the browser.');
      return;
    }
    if (this.state().notificationsEnabled) {
      this.state.update(s => ({ ...s, notificationsEnabled: false }));
      await this.cancelAllReminders();
      return;
    }
    const { display } = await CapNotifications.requestPermissions();
    if (display === 'granted') {
      this.state.update(s => ({ ...s, notificationsEnabled: true }));
      this.scheduleAllReminders();
    } else {
      alert('Notification permission denied. Enable it in your phone Settings.');
    }
  }

  protected async scheduleAllReminders(): Promise<void> {
    if (!CapNotifications || !this.state().notificationsEnabled) return;
    const notifications: LocalNotification[] = [];
    let idCounter = 1;
    for (const section of this.state().sections) {
      for (const todo of this.state().todos[section] ?? []) {
        if (todo.dueDate && todo.reminderEnabled && !todo.done) {
          const due = new Date(todo.dueDate + 'T09:00:00');
          if (due > new Date()) {
            notifications.push({
              id: idCounter++,
              title: '📋 Todo Reminder',
              body: `"${todo.text}" is due today`,
              schedule: { at: due },
              channelId: 'todo-reminders',
            });
          }
        }
      }
    }
    if (notifications.length > 0) {
      await CapNotifications.schedule({ notifications });
    }
  }

  private async cancelAllReminders(): Promise<void> {
    if (!CapNotifications) return;
    const ids = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    await CapNotifications.cancel({ notifications: ids });
  }

  protected toggleTodoReminder(todoId: string): void {
    const section = this.state().activeTab;
    this.state.update(s => ({
      ...s,
      todos: {
        ...s.todos,
        [section]: (s.todos[section] ?? []).map(t =>
          t.id === todoId ? { ...t, reminderEnabled: !t.reminderEnabled } : t
        ),
      },
    }));
    if (this.state().notificationsEnabled) this.scheduleAllReminders();
  }

  // ── Folder Sync ────────────────────────────────────
  protected isFSAccessSupported(): boolean {
    return typeof (window as any).showDirectoryPicker === 'function';
  }

  private async tryRestoreSyncHandle(): Promise<void> {
    if (IS_NATIVE) {
      const uri = await storageGet(NATIVE_SYNC_URI_KEY);
      const name = await storageGet(NATIVE_SYNC_NAME_KEY);
      if (uri && name) {
        this.sync.set({ status: 'connected', folderName: name });
        await this.writeNativeSync();
      }
      return;
    }
    if (!this.isFSAccessSupported()) return;
    try {
      const db = await this.openHandleDB();
      const handle = await this.getHandleFromDB(db);
      if (!handle) return;
      const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') await this.connectFolder(handle);
    } catch { /* silent */ }
  }

  protected async chooseSyncFolder(): Promise<void> {
    if (IS_NATIVE) { await this.connectNativeSync(); return; }
    if (!this.isFSAccessSupported()) {
      alert('Folder sync is not supported in this environment. Use Export/Import as a backup instead.');
      return;
    }
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await this.connectFolder(handle);
    } catch (e: any) {
      if (e.name !== 'AbortError') alert('Could not access folder.');
    }
  }

  private async connectFolder(handle: FileSystemDirectoryHandle): Promise<void> {
    this.syncDirHandle = handle;
    await this.storeHandle(handle);
    this.sync.set({ status: 'connected', folderName: handle.name });
    await this.syncToFolder();
  }

  private async connectNativeSync(): Promise<void> {
    try {
      const { uri, name } = await FolderPicker.pickDirectory();
      await storageSet(NATIVE_SYNC_URI_KEY, uri);
      await storageSet(NATIVE_SYNC_NAME_KEY, name);
      this.sync.set({ status: 'connected', folderName: name });
      await this.writeNativeSync();
    } catch (e: any) {
      if (e?.message !== 'CANCELLED') alert('Could not access folder.');
    }
  }

  private async writeNativeSync(): Promise<void> {
    const uri = await storageGet(NATIVE_SYNC_URI_KEY);
    if (!uri) return;
    try {
      await FolderPicker.writeFile({
        uri,
        filename: SYNC_FILENAME,
        data: JSON.stringify({
          syncedAt: new Date().toISOString(), version: 7,
          sections: this.state().sections, todos: this.state().todos, completed: this.state().completed,
        }, null, 2),
      });
    } catch {
      this.sync.set({ status: 'disconnected', folderName: this.sync().folderName });
    }
  }

  protected async disconnectSync(): Promise<void> {
    if (IS_NATIVE) {
      await storageSet(NATIVE_SYNC_URI_KEY, '');
      await storageSet(NATIVE_SYNC_NAME_KEY, '');
      this.sync.set({ status: 'idle', folderName: null });
      return;
    }
    this.syncDirHandle = null;
    this.sync.set({ status: 'idle', folderName: null });
    try {
      const db = await this.openHandleDB();
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete('syncDir');
    } catch { /* silent */ }
  }

  protected async syncNow(): Promise<void> {
    if (IS_NATIVE) { await this.writeNativeSync(); alert('Synced!'); return; }
    if (!this.syncDirHandle) return;
    await this.syncToFolder();
    alert('Synced to ' + this.syncDirHandle.name);
  }

  private debouncedSyncToFolder(): void {
    if (!IS_NATIVE && !this.syncDirHandle) return;
    if (IS_NATIVE && this.sync().status !== 'connected') return;
    if (this.syncSaveTimeout) clearTimeout(this.syncSaveTimeout);
    this.syncSaveTimeout = setTimeout(() => IS_NATIVE ? this.writeNativeSync() : this.syncToFolder(), 1500);
  }

  private async syncToFolder(): Promise<void> {
    if (IS_NATIVE) { await this.writeNativeSync(); return; }
    if (!this.syncDirHandle) return;
    try {
      const fileHandle = await (this.syncDirHandle as any).getFileHandle(SYNC_FILENAME, { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(JSON.stringify({
        syncedAt: new Date().toISOString(), version: 7,
        sections: this.state().sections, todos: this.state().todos, completed: this.state().completed,
      }, null, 2));
      await writable.close();
    } catch (e: any) {
      if (e.name === 'NotAllowedError') { this.syncDirHandle = null; this.sync.set({ status: 'disconnected', folderName: this.sync().folderName }); }
    }
  }

  private openHandleDB(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const req = indexedDB.open('todo-sync-db', 1);
      req.onupgradeneeded = e => (e.target as IDBOpenDBRequest).result.createObjectStore('handles');
      req.onsuccess = e => res((e.target as IDBOpenDBRequest).result);
      req.onerror = e => rej((e.target as IDBOpenDBRequest).error);
    });
  }
  private storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    return this.openHandleDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'syncDir');
      tx.oncomplete = () => res(); tx.onerror = e => rej((e.target as IDBRequest).error);
    }));
  }
  private getHandleFromDB(db: IDBDatabase): Promise<FileSystemDirectoryHandle | null> {
    return new Promise((res, rej) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('syncDir');
      req.onsuccess = e => res((e.target as IDBRequest).result ?? null);
      req.onerror = e => rej((e.target as IDBRequest).error);
    });
  }

  // ── Export / Import ────────────────────────────────
  protected toggleExportMenu(): void { this.showExportMenu.update(v => !v); }
  protected closeExportMenu(): void { this.showExportMenu.set(false); }
  protected copySyncPath(): void {
    const path = this.sync().folderName;
    if (path) navigator.clipboard?.writeText(path);
    this.closeExportMenu();
  }

  protected exportData(): void {
    this.closeExportMenu();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: 7, sections: this.state().sections, todos: this.state().todos, completed: this.state().completed }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `todos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  protected triggerImport(): void { this.closeExportMenu(); document.getElementById('import-file-input')?.click(); }

  protected importData(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!data.sections || !data.todos) { alert('Invalid backup file.'); return; }
        const merge = confirm('OK = Merge with existing\nCancel = Replace all');
        if (merge) {
          this.state.update(s => {
            const sections = [...new Set([...s.sections, ...data.sections])];
            const todos = { ...s.todos };
            data.sections.forEach((sec: string) => {
              if (!todos[sec]) todos[sec] = [];
              const ids = new Set(todos[sec].map((t: Todo) => t.id));
              (data.todos[sec] ?? []).forEach((t: Todo) => { if (!ids.has(t.id)) todos[sec].push(t); });
            });
            const cIds = new Set(s.completed.map(c => c.id));
            return { ...s, sections, todos, completed: [...s.completed, ...(data.completed ?? []).filter((c: CompletedTodo) => !cIds.has(c.id))] };
          });
        } else {
          const p = this.parseState(JSON.stringify({ ...data, theme: this.state().theme }));
          if (p) this.state.set(p);
        }
      } catch { alert('Failed to read backup file.'); }
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  }

  // ── Search ─────────────────────────────────────────
  protected setSearch(q: string): void { this.searchQuery.set(q); }
  protected clearSearch(): void { this.searchQuery.set(''); }
  protected setSort(sort: SortBy): void { this.sortBy.set(sort); }
  protected setFilter(filter: FilterBy): void { this.filterBy.set(filter); }

  // ── View switching ─────────────────────────────────
  protected setView(v: ActiveView): void { this.activeView.set(v); this.searchQuery.set(''); }

  // ── Drag & Drop ────────────────────────────────────
  protected onDragStart(todoId: string, event: DragEvent): void { this.dragId.set(todoId); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
  protected onDragOver(todoId: string, event: DragEvent): void { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; this.dragOverId.set(todoId); }
  protected onDragLeave(): void { this.dragOverId.set(null); }
  protected onDrop(targetId: string, event: DragEvent): void {
    event.preventDefault();
    const fromId = this.dragId(); this.dragId.set(null); this.dragOverId.set(null);
    if (!fromId || fromId === targetId) return;
    const section = this.state().activeTab;
    this.state.update(s => {
      const todos = [...(s.todos[section] ?? [])];
      const fi = todos.findIndex(t => t.id === fromId), ti = todos.findIndex(t => t.id === targetId);
      if (fi === -1 || ti === -1) return s;
      const [m] = todos.splice(fi, 1); todos.splice(ti, 0, m);
      return { ...s, todos: { ...s.todos, [section]: todos } };
    });
  }
  protected onDragEnd(): void { this.dragId.set(null); this.dragOverId.set(null); }

  private touchDragId: string | null = null;
  protected onTouchDragStart(todoId: string, event: TouchEvent): void {
    if (!(event.target as HTMLElement).closest('.drag-handle')) return;
    event.preventDefault(); this.touchDragId = todoId; this.dragId.set(todoId);
  }
  protected onTouchDragMove(event: TouchEvent): void {
    if (!this.touchDragId) return; event.preventDefault();
    const t = event.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-todo-id]') as HTMLElement | null;
    if (el) { const id = el.dataset['todoId']; if (id && id !== this.touchDragId) this.dragOverId.set(id); }
  }
  protected onTouchDragEnd(_event: TouchEvent): void {
    if (!this.touchDragId) return;
    const overId = this.dragOverId();
    if (overId && overId !== this.touchDragId) this.onDrop(overId, new DragEvent('drop'));
    this.touchDragId = null; this.dragId.set(null); this.dragOverId.set(null);
  }

  // ── Completed ──────────────────────────────────────
  protected restoreTodo(completedId: string): void {
    const item = this.state().completed.find(c => c.id === completedId); if (!item) return;
    const { section, completedAt, ...rest } = item;
    const restored: Todo = { ...rest, done: false, subItems: rest.subItems.map(s => ({ ...s, done: false })) };
    this.state.update(s => {
      const sections = s.sections.includes(section) ? s.sections : [...s.sections, section];
      return { ...s, sections, todos: { ...s.todos, [section]: [...(s.todos[section] ?? []), restored] }, completed: s.completed.filter(c => c.id !== completedId) };
    });
  }
  protected deleteCompleted(completedId: string): void { this.state.update(s => ({ ...s, completed: s.completed.filter(c => c.id !== completedId) })); }
  protected clearAllCompleted(): void { if (!confirm('Delete all completed todos?')) return; this.state.update(s => ({ ...s, completed: [] })); }

  // ── Tab actions ───────────────────────────────────
  protected switchTab(section: string): void {
    if (this.activeView() !== 'todos') this.activeView.set('todos');
    if (this.state().activeTab === section) { this.openMenu(section); return; }
    this.menuOpenFor.set(null); this.subInputFor.set(null); this.notesPanelFor.set(null);
    this.state.update(s => ({ ...s, activeTab: section }));
  }
  protected addSection(): void {
    const name = prompt('Section name?'); if (!name) return;
    const t = name.trim(); if (!t) return;
    if (this.state().sections.includes(t)) { alert('Already exists.'); return; }
    this.state.update(s => ({ ...s, sections: [...s.sections, t], todos: { ...s.todos, [t]: [] }, activeTab: t }));
  }

  // ── Long-press ─────────────────────────────────────
  protected onTabPressStart(section: string, _e: Event): void {
    this.clearLongPressTimer();
    this.longPressTimer = setTimeout(() => { if ('vibrate' in navigator) navigator.vibrate(20); this.openMenu(section); this.longPressTimer = null; }, LONG_PRESS_MS);
  }
  protected onTabPressEnd(): void { this.clearLongPressTimer(); }
  protected onTabContextMenu(section: string, e: MouseEvent): void { e.preventDefault(); this.openMenu(section); }
  private clearLongPressTimer(): void { if (this.longPressTimer !== null) { clearTimeout(this.longPressTimer); this.longPressTimer = null; } }

  // ── Menu ──────────────────────────────────────────
  private openMenu(s: string): void { this.menuOpenFor.set(s); }
  protected closeMenu(): void { this.menuOpenFor.set(null); }
  protected renameSection(oldName: string): void {
    this.closeMenu();
    const next = prompt(`Rename "${oldName}" to:`, oldName); if (!next) return;
    const t = next.trim(); if (!t || t === oldName) return;
    if (this.state().sections.includes(t)) { alert('Already exists.'); return; }
    this.state.update(s => {
      const sections = s.sections.map(x => x === oldName ? t : x);
      const todos = { ...s.todos }; todos[t] = todos[oldName] ?? []; delete todos[oldName];
      const completed = s.completed.map(c => c.section === oldName ? { ...c, section: t } : c);
      return { ...s, sections, todos, completed, activeTab: s.activeTab === oldName ? t : s.activeTab, theme: s.theme };
    });
  }
  protected deleteSection(name: string): void {
    this.closeMenu();
    if (this.state().sections.length <= 1) { alert('Need at least one section.'); return; }
    const count = (this.state().todos[name] ?? []).length;
    if (!confirm(count > 0 ? `Delete "${name}" and its ${count} todo(s)?` : `Delete "${name}"?`)) return;
    this.state.update(s => {
      const sections = s.sections.filter(x => x !== name);
      const todos = { ...s.todos }; delete todos[name];
      return { ...s, sections, todos, activeTab: s.activeTab === name ? sections[0] : s.activeTab, theme: s.theme };
    });
  }

  // ── Todo actions ──────────────────────────────────
  protected addTodo(): void {
    const text = this.newTodoText().trim(); if (!text) return;
    const todo: Todo = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text, done: false, priority: this.newTodoPriority(),
      dueDate: this.newTodoDueDate() || null, subItems: [], notes: [],
      reminderEnabled: this.newTodoReminder() && !!this.newTodoDueDate(),
    };
    const section = this.state().activeTab;
    this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: [...(s.todos[section] ?? []), todo] } }));
    this.newTodoText.set(''); this.newTodoDueDate.set('');
    this.newTodoPriority.set('medium'); this.newTodoReminder.set(false);
    if (todo.reminderEnabled) this.scheduleAllReminders();
  }

  protected toggleTodo(id: string): void {
    const section = this.state().activeTab;
    const todo = (this.state().todos[section] ?? []).find(t => t.id === id); if (!todo) return;
    if (!todo.done) {
      const completed: CompletedTodo = { ...todo, done: true, section, completedAt: new Date().toISOString(), subItems: todo.subItems.map(s => ({ ...s, done: true })) };
      this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).filter(t => t.id !== id) }, completed: [completed, ...s.completed] }));
    } else {
      this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).map(t => t.id === id ? { ...t, done: false } : t) } }));
    }
  }
  protected deleteTodo(id: string): void {
    const section = this.state().activeTab;
    this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).filter(t => t.id !== id) } }));
  }
  protected cyclePriority(id: string): void {
    const section = this.state().activeTab;
    this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).map(t => t.id === id ? { ...t, priority: PRIORITY_CYCLE[t.priority] } : t) } }));
  }
  protected sectionCount(section: string): number { return (this.state().todos[section] ?? []).length; }

  // ── Due date helpers ──────────────────────────────
  protected dueDateLabel(dueDate: string | null): string {
    if (!dueDate) return '';
    const today = new Date(); today.setHours(0,0,0,0);
    const due = new Date(dueDate + 'T00:00:00');
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diff < 0) return 'Overdue'; if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    return `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  protected isOverdue(dueDate: string | null): boolean {
    if (!dueDate) return false;
    const today = new Date(); today.setHours(0,0,0,0);
    return new Date(dueDate + 'T00:00:00') < today;
  }

  // ── Notes ─────────────────────────────────────────
  protected toggleNotesPanel(todoId: string): void { this.notesPanelFor.update(cur => cur === todoId ? null : todoId); this.newNoteText.set(''); }
  protected addNote(todoId: string): void {
    const text = this.newNoteText().trim(); if (!text) return;
    const note: Note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text, createdAt: new Date().toISOString() };
    const section = this.state().activeTab;
    this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).map(t => t.id === todoId ? { ...t, notes: [...t.notes, note] } : t) } }));
    this.newNoteText.set('');
  }
  protected deleteNote(todoId: string, noteId: string): void {
    const section = this.state().activeTab;
    this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).map(t => t.id === todoId ? { ...t, notes: t.notes.filter(n => n.id !== noteId) } : t) } }));
  }

  // ── Sub-items ─────────────────────────────────────
  protected toggleSubInput(todoId: string): void { this.subInputFor.update(cur => cur === todoId ? null : todoId); this.newSubText.set(''); }
  protected addSubItem(todoId: string): void {
    const text = this.newSubText().trim(); if (!text) return;
    const sub: SubItem = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text, done: false };
    const section = this.state().activeTab;
    this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).map(t => t.id === todoId ? { ...t, subItems: [...t.subItems, sub] } : t) } }));
    this.newSubText.set('');
  }
  protected toggleSubItem(todoId: string, subId: string): void {
    const section = this.state().activeTab;
    this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).map(t => t.id === todoId ? { ...t, subItems: t.subItems.map(sub => sub.id === subId ? { ...sub, done: !sub.done } : sub) } : t) } }));
  }
  protected deleteSubItem(todoId: string, subId: string): void {
    const section = this.state().activeTab;
    this.state.update(s => ({ ...s, todos: { ...s.todos, [section]: (s.todos[section] ?? []).map(t => t.id === todoId ? { ...t, subItems: t.subItems.filter(sub => sub.id !== subId) } : t) } }));
  }
  protected subProgress(todo: Todo): { done: number; total: number } { return { total: todo.subItems.length, done: todo.subItems.filter(s => s.done).length }; }
  protected formatDate(iso: string): string { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

  // ── Chart helpers ──────────────────────────────────
  protected chartMax(): number { return Math.max(...this.chartData().map(d => d.count), 1); }

  // ── Persistence ────────────────────────────────────
  private parseState(raw: string): AppState | null {
    try {
      const p = JSON.parse(raw) as Partial<AppState>;
      const sections = p.sections ?? DEFAULT_STATE.sections;
      const todos: { [s: string]: Todo[] } = {};
      const rawTodos = p.todos ?? {};
      sections.forEach(s => {
        todos[s] = (rawTodos[s] ?? []).map((t: Partial<Todo>) => ({
          id: t.id ?? '', text: t.text ?? '', done: t.done ?? false,
          priority: (t.priority as Priority) ?? 'medium', dueDate: t.dueDate ?? null,
          reminderEnabled: t.reminderEnabled ?? false,
          subItems: (t.subItems ?? []).map((sub: Partial<SubItem>) => ({ id: sub.id ?? '', text: sub.text ?? '', done: sub.done ?? false })),
          notes: (t.notes ?? []).map((n: Partial<Note>) => ({ id: n.id ?? '', text: n.text ?? '', createdAt: n.createdAt ?? '' })),
        }));
      });
      const completed: CompletedTodo[] = (p.completed ?? []).map((c: Partial<CompletedTodo>) => ({
        id: c.id ?? '', text: c.text ?? '', done: true,
        priority: (c.priority as Priority) ?? 'medium', dueDate: c.dueDate ?? null,
        reminderEnabled: c.reminderEnabled ?? false,
        subItems: (c.subItems ?? []).map((sub: Partial<SubItem>) => ({ id: sub.id ?? '', text: sub.text ?? '', done: sub.done ?? false })),
        notes: (c.notes ?? []).map((n: Partial<Note>) => ({ id: n.id ?? '', text: n.text ?? '', createdAt: n.createdAt ?? '' })),
        section: c.section ?? sections[0], completedAt: c.completedAt ?? '',
      }));
      const activeTab = p.activeTab && sections.includes(p.activeTab) ? p.activeTab : sections[0];
      return { sections, activeTab, todos, completed, theme: p.theme === 'dark' ? 'dark' : 'light', notificationsEnabled: p.notificationsEnabled ?? false };
    } catch { return null; }
  }
}