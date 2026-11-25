export type Role = "admin" | "member";

export type User = { id: string; name: string; email: string; role: Role; createdAt: string };

export type FileInfo = { id: string; name: string; mime: string; size: number };

export type Reaction = { emoji: string; userIds: string[] };

export type Message = {
  id: number;
  conversationId: string;
  userId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Set on a reply: the message that started the thread. Threads are one level deep. */
  parentId: number | null;
  /** On a message that started a thread. */
  replyCount: number;
  lastReplyAt: string | null;
  files: FileInfo[];
  reactions: Reaction[];
  /** The people this message mentions (@Name, or everybody with @tous). */
  mentionIds: string[];
  /** A video call started here: the message is its card. */
  call: CallInfo | null;
};

/** A video call of a conversation. Its room lives in Alfred (the engine stays there). */
export type CallInfo = { slug: string; title: string };

/** What a call card shows, read from Alfred. */
export type CallStatus = { status: "open" | "ended" | "closed" | "unavailable" | string; live: number | null };

export type Conversation = {
  id: string;
  kind: "channel" | "dm";
  /** Channel name (without the #). Empty for a direct message. */
  name: string;
  topic: string;
  /** Private channel: only its members see it. */
  private: boolean;
  /** Private channel: who is in it. */
  memberIds?: string[];
  /** Direct message: the other person (yourself for your own notes). */
  otherUserId?: string;
  unread: number;
  /** Among the unread messages, how many mention me. */
  mentions: number;
  lastMessageId: number;
  /** I may rename this channel and manage its members (its creator, or an admin). */
  canManage: boolean;
};

export type SearchHit = { id: number; conversationId: string; parentId: number | null; userId: string; body: string; createdAt: string };

export type ModuleStatus = "core" | "linked" | "soon";

export type ModuleInfo = {
  id: string;
  name: string;
  role: string;
  description: string;
  icon: string;
  status: ModuleStatus;
  /** Inside this app (core modules). */
  href?: string;
  /** Where the tool lives when it is linked (its own address, for now). */
  url?: string;
  /** The tool accepts the account of this app ("Se connecter avec Lamio"). */
  sso?: boolean;
  /** With single sign-on: whether I may open it. */
  allowed?: boolean;
  /** With single sign-on, for admins: the members who may open it. */
  allowedIds?: string[];
  /** Shown inside this app as well (Alfred's calendar in the Calendrier tab). Access is managed like single sign-on. */
  embedded?: boolean;
};

export type AppState = {
  me: User;
  users: User[];
  conversations: Conversation[];
  modules: ModuleInfo[];
  /** The Calendrier tab (Alfred's calendar): whether I see it. */
  calendar: boolean;
  /** Video calls in conversations (through Alfred's video): whether they are plugged in. */
  calls: boolean;
};

export type CalendarSource = "local" | "caldav";

export type RepeatRule = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";

/** A calendar of Alfred. */
export type CalendarInfo = { id: string; name: string; color: string; source: CalendarSource; visible: boolean; readOnly: boolean };

/** One occurrence of an event (a recurring event gives several). */
export type CalendarEvent = {
  /** Unique within a response: the event and its occurrence. */
  key: string;
  /** The event in Alfred. */
  id: string;
  /** For a recurring event: which occurrence (its original start). */
  occurrenceId: string | null;
  /** The simple repeat rule, or "custom" for one Alfred cannot sum up. */
  repeat: RepeatRule;
  calendarId: string;
  title: string;
  /** ISO instant, or a date (YYYY-MM-DD) for an all-day event, end excluded. */
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  recurring: boolean;
};

export type CalendarData = {
  alfredUrl: string;
  /** Lamio may create and edit events (its token of Alfred allows writing). */
  writable: boolean;
  calendars: CalendarInfo[];
  events: CalendarEvent[];
};

/** What the Calendrier tab sends to create or edit an event. Dates for all-day events, end excluded. */
export type EventInput = {
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  repeat: RepeatRule;
};

/** What the server pushes over /api/events. */
export type ServerEvent =
  | { type: "message"; message: Message }
  | { type: "message-updated"; message: Message }
  | { type: "message-deleted"; conversationId: string; id: number; parentId: number | null }
  | { type: "refresh" };
