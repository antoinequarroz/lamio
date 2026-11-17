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
  lastMessageId: number;
};

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
};

export type AppState = { me: User; users: User[]; conversations: Conversation[]; modules: ModuleInfo[] };

/** What the server pushes over /api/events. */
export type ServerEvent =
  | { type: "message"; message: Message }
  | { type: "message-updated"; message: Message }
  | { type: "message-deleted"; conversationId: string; id: number; parentId: number | null }
  | { type: "refresh" };
