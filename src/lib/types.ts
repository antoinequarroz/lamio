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
};

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
};

export type AppState = {
  me: User;
  users: User[];
  conversations: Conversation[];
  modules: ModuleInfo[];
  /** My mailbox, when one is plugged in: the unread mails of the inbox, for the Mails tab badge. */
  mail: { unread: number } | null;
};

/** What the server pushes over /api/events. */
export type ServerEvent =
  | { type: "message"; message: Message }
  | { type: "message-updated"; message: Message }
  | { type: "message-deleted"; conversationId: string; id: number; parentId: number | null }
  | { type: "refresh" }
  /** My mailbox changed (new mails, flags, folders) or its connection status did. */
  | { type: "mail"; status: MailStatus; folders: string[]; live?: boolean; added?: MailSummary[]; alert?: MailSummary[]; sent?: { id: string; error?: string } };

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
};

export type MailNotify = "all" | "known" | "off";

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
