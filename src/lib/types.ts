export type Role = "admin" | "member";

export type User = { id: string; name: string; email: string; role: Role; createdAt: string };

export type FileInfo = { id: string; name: string; mime: string; size: number };

export type Message = {
  id: number;
  conversationId: string;
  userId: string;
  body: string;
  createdAt: string;
  files: FileInfo[];
};

export type Conversation = {
  id: string;
  kind: "channel" | "dm";
  /** Channel name (without the #). Empty for a direct message. */
  name: string;
  topic: string;
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
  | { type: "message-deleted"; conversationId: string; id: number }
  | { type: "refresh" };
