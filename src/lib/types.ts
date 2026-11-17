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

export type TaskStatus = "todo" | "doing" | "done";

export type Project = {
  id: string;
  name: string;
  description: string;
  /** Its channel in the messaging, when it has one. */
  conversationId: string | null;
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
  taskCount: number;
  doneCount: number;
  /** The closest deadline among the tasks still to do ("YYYY-MM-DD"). */
  nextDue: string | null;
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** A day, "YYYY-MM-DD". */
  dueDate: string | null;
  assigneeId: string | null;
  /** Order inside its column. */
  position: number;
  createdBy: string | null;
  createdAt: string;
  doneAt: string | null;
};

/** A task outside its project page: in "Mes tâches" and in the search. */
export type TaskWithProject = Task & { projectName: string };

export type AppState = { me: User; users: User[]; conversations: Conversation[]; modules: ModuleInfo[]; projects: Project[] };

/** What the server pushes over /api/events. */
export type ServerEvent =
  | { type: "message"; message: Message }
  | { type: "message-updated"; message: Message }
  | { type: "message-deleted"; conversationId: string; id: number; parentId: number | null }
  /** Something changed in this project or its tasks. */
  | { type: "project"; projectId: string }
  | { type: "refresh" };
