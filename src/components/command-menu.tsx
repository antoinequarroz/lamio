"use client";

import { Command } from "cmdk";
import { Hash, LayoutGrid, Lock, Plus, Settings, SquarePen, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { api } from "@/lib/utils";

export function CommandMenu() {
  const { conversations, users, me, commandOpen: open, setCommandOpen: setOpen, setDialog, reload } = useApp();
  const router = useRouter();

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const openDm = async (userId: string) => {
    const { id } = await api<{ id: string }>("/api/conversations", { method: "POST", json: { kind: "dm", userId } });
    await reload();
    router.push(`/c/${id}`);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Recherche"
      overlayClassName="fixed inset-0 z-40 bg-[rgba(15,14,12,0.3)] backdrop-blur-[2px]"
      contentClassName="fixed top-[16vh] left-1/2 z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]"
    >
      <Command.Input placeholder="Aller à un canal, une personne, une action…" className="h-12 w-full border-b border-line bg-transparent px-4 text-[14.5px] outline-none placeholder:text-ink-3" />
      <Command.List className="scroll-thin max-h-[380px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
        <Command.Empty className="py-10 text-center text-[13px] text-ink-3">Aucun résultat.</Command.Empty>
        <Command.Group heading="Canaux">
          {conversations
            .filter((c) => c.kind === "channel")
            .map((c) => (
              <Item key={c.id} value={`canal ${c.name} ${c.topic} ${c.id}`} onSelect={() => run(() => router.push(`/c/${c.id}`))} icon={c.private ? <Lock className="size-4" /> : <Hash className="size-4" />}>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.topic && <span className="max-w-[45%] shrink-0 truncate text-[11.5px] text-ink-3">{c.topic}</span>}
              </Item>
            ))}
        </Command.Group>
        <Command.Group heading="Personnes">
          {users.map((u) => (
            <Item key={u.id} value={`personne ${u.name} ${u.email} ${u.id}`} onSelect={() => run(() => openDm(u.id))} icon={<User className="size-4" />}>
              <span className="min-w-0 flex-1 truncate">{u.id === me.id ? `${u.name} (toi)` : u.name}</span>
              <span className="shrink-0 text-[11.5px] text-ink-3">{u.email}</span>
            </Item>
          ))}
        </Command.Group>
        <Command.Group heading="Actions">
          <Item onSelect={() => run(() => setDialog("dm"))} icon={<SquarePen className="size-4" />}>
            Nouveau message
          </Item>
          <Item onSelect={() => run(() => setDialog("channel"))} icon={<Plus className="size-4" />}>
            Créer un canal
          </Item>
          <Item onSelect={() => run(() => router.push("/modules"))} icon={<LayoutGrid className="size-4" />}>
            Modules
          </Item>
          <Item onSelect={() => run(() => router.push("/settings"))} icon={<Settings className="size-4" />}>
            Réglages
          </Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Item({ children, icon, onSelect, value }: { children: React.ReactNode; icon: React.ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink">
      <span className="text-ink-3">{icon}</span>
      {children}
    </Command.Item>
  );
}
