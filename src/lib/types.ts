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
  /** My mailbox, when one is plugged in: the unread mails of the inbox, for the Mails tab badge. */
  mail: { unread: number } | null;
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
  | { type: "refresh" }
  /** My mailbox changed (new mails, flags, folders) or its connection status did. */
  | { type: "mail"; status: MailStatus; folders: string[]; live?: boolean; added?: MailSummary[]; alert?: MailSummary[]; sent?: { id: string; error?: string }; reminder?: MailReminder };

// ---- Mails

/** pending: never synced yet. auth: the server refused the password, nothing is retried until it changes. */
export type MailStatus = "pending" | "syncing" | "ok" | "error" | "auth";

export type MailAccountInfo = {
  email: string;
  username: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  status: MailStatus;
  lastError: string | null;
  syncedAt: string | null;
  /** Added under each new mail (plain text). */
  signature: string;
  /** Which new mails notify: all, only from people I have written to, or none. */
  notify: MailNotify;
  /** The permanent IMAP IDLE connection is open: new mails arrive within a second or two. */
  live: boolean;
  /** The addresses I send from, the mailbox's own first (its signature is `signature`). */
  identities: MailIdentity[];
  /** The AI help (summary, draft reply) is on: the server has an Anthropic key. Filled by the routes. */
  ai?: boolean;
};

/** Something a conversation asks of me, found by the AI help: a meeting, a task, an amount. */
export type MailAiAction = {
  kind: "rdv" | "tache" | "montant";
  title: string;
  /** Local time of Switzerland, "2026-11-27T14:00" (or "2026-11-27" for a whole day); empty when unknown. */
  start: string;
  end: string;
  allDay: boolean;
  amount: string;
  details: string;
};

/** A conversation summed up by the AI help. */
export type MailAiSummary = { summary: string; actions: MailAiAction[]; mails: number; at: string };

/** An address I send from: the mailbox's own, or an alias delivered into it. */
export type MailIdentity = {
  address: string;
  /** The name shown to the recipient; empty: my Lamio name. */
  name: string;
  signature: string;
  primary: boolean;
};

export type MailNotify = "all" | "important" | "known" | "off";

/** Something the server tells me about later: a mail nobody answered, a scheduled send that left. */
export type MailReminder = { title: string; body: string; folder?: string; uid?: number };

/** What waits on the server: a scheduled send, a snoozed mail, a follow-up. */
export type MailLaterInfo = {
  id: string;
  kind: "send" | "snooze" | "followup";
  due: string;
  subject: string;
  to: string;
  messageIds: string[];
  /** Where the mails are now (« Reportés » for a snooze, Sent for a follow-up). */
  refs: { folder: string; uid: number }[];
};

/** The tabs of the sorted inbox. */
export type MailCategory = "important" | "newsletter" | "notification";

export type MailFolder = { path: string; name: string; delimiter: string; specialUse: string | null; total: number; unread: number };

export type MailAddress = { name: string; address: string };

/** A file of a mail; part is its place in the mail (IMAP section, "2" or "1.2"), to download it. */
export type MailAttachment = { name: string; type: string; size: number; part: string };

/**
 * An opened mail. html is already cleaned on the server (see server/mail/html.ts), null for a
 * text-only mail; remoteImages says it has images to load from the internet, blocked until asked;
 * trusted: the person chose to always show the images of this sender.
 */
export type MailContent = MailSummary & { text: string; html: string | null; remoteImages: boolean; attachmentList: MailAttachment[]; trusted: boolean };

/** A conversation, as a row of the list: shown with its newest mail of the folder. */
export type MailThreadInfo = {
  id: string;
  /** Mails in the whole conversation (the folder, Sent, Archives…; not Trash or Spam). */
  count: number;
  /** Unread mails of the conversation in this folder. */
  unread: number;
  /** The uids of the conversation's mails in this folder: what an action on the row applies to. */
  uids: number[];
  /** Who wrote, oldest first ("moi" for my own mails). */
  participants: string[];
};

export type MailSummary = {
  /** Only in the "Par conversation" view. */
  thread?: MailThreadInfo;
  folder: string;
  uid: number;
  messageId: string | null;
  subject: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  date: string;
  preview: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  attachments: boolean;
  size: number;
  /** Where the sorted inbox puts it (in the inbox and its tabs). */
  category?: MailCategory;
  /** It can be left in one click (List-Unsubscribe). */
  unsubscribe?: boolean;
};

/** Who a mail is written to, and how it relates to another one. */
export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

/** What can be done to mails from Lamio (on the real mailbox). "delete" is for good, from the Trash or the Spam. */
export type MailAction =
  | { type: "seen"; value: boolean }
  | { type: "flagged"; value: boolean }
  | { type: "move"; to: string }
  | { type: "archive" }
  | { type: "trash" }
  | { type: "spam" }
  | { type: "delete" };
