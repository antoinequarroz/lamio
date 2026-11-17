"use client";

import { Lock, LogOut, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { api, slugify } from "@/lib/utils";
import { Avatar, Button, Field, inputClass, Modal } from "./ui";

export function NewChannelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { reload } = useApp();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const slug = slugify(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>("/api/conversations", { method: "POST", json: { kind: "channel", name, topic, private: isPrivate } });
      await reload();
      onClose();
      router.push(`/c/${id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Nouveau canal" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Nom" hint={slug ? `Il s'appellera #${slug}` : "Un sujet, un projet, une équipe."}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="ex. projets" className={inputClass} />
        </Field>
        <Field label="Description (facultatif)">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder="À quoi sert ce canal ?" className={inputClass} />
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
              <Lock className="size-3.5 text-ink-3" />
              Canal privé
            </span>
            <span className="mt-0.5 block text-[12.5px] text-ink-3">Seules les personnes que tu y ajoutes le voient. Sinon, il est ouvert à toute l&apos;équipe.</span>
          </span>
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={busy || !slug}>
            Créer le canal
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function NewDmDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { users, me, reload } = useApp();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const people = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q));

  const open = async (userId: string) => {
    try {
      const { id } = await api<{ id: string }>("/api/conversations", { method: "POST", json: { kind: "dm", userId } });
      await reload();
      onClose();
      router.push(`/c/${id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Modal title="Nouveau message" onClose={onClose}>
      <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher une personne…" className={inputClass} />
      <div className="scroll-thin -mx-2 mt-3 flex max-h-[300px] flex-col gap-px overflow-y-auto px-2">
        {people.map((u) => (
          <button key={u.id} onClick={() => open(u.id)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.05]">
            <Avatar id={u.id} name={u.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium leading-tight">
                {u.name}
                {u.id === me.id && <span className="font-normal text-ink-3"> (toi, pour tes notes)</span>}
              </span>
              <span className="block truncate text-[12px] leading-tight text-ink-3">{u.email}</span>
            </span>
          </button>
        ))}
        {!people.length && <p className="py-6 text-center text-[13px] text-ink-3">Personne ne correspond.</p>}
      </div>
      {users.length === 1 && <p className="mt-3 text-[12.5px] text-ink-3">Tu es seul pour l&apos;instant. Ajoute des membres dans Réglages.</p>}
    </Modal>
  );
}

/** Who is in a private channel: add someone, or leave. */
export function MembersDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const router = useRouter();
  const { users, me, reload } = useApp();
  const members = users.filter((u) => conversation.memberIds?.includes(u.id));
  const others = users.filter((u) => !conversation.memberIds?.includes(u.id));

  const add = async (userId: string) => {
    try {
      await api(`/api/conversations/${conversation.id}/members`, { method: "POST", json: { userId } });
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const leave = async () => {
    const last = members.length === 1;
    if (!window.confirm(last ? `Tu es la dernière personne dans #${conversation.name} : en le quittant, le canal et ses messages seront supprimés. Continuer ?` : `Quitter #${conversation.name} ? Il faudra qu'un membre t'y ajoute à nouveau pour y revenir.`)) return;
    try {
      await api(`/api/conversations/${conversation.id}/members`, { method: "DELETE" });
      onClose();
      router.push("/c");
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Modal title={`Membres de #${conversation.name}`} onClose={onClose}>
      <ul className="scroll-thin -mx-2 flex max-h-[240px] flex-col gap-px overflow-y-auto px-2">
        {members.map((u) => (
          <li key={u.id} className="flex items-center gap-2.5 px-2 py-1.5">
            <Avatar id={u.id} name={u.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium leading-tight">
                {u.name}
                {u.id === me.id && <span className="font-normal text-ink-3"> (toi)</span>}
              </span>
              <span className="block truncate text-[12px] leading-tight text-ink-3">{u.email}</span>
            </span>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <span className="text-[12px] font-medium text-ink-2">Ajouter quelqu&apos;un</span>
          <div className="scroll-thin -mx-2 mt-1.5 flex max-h-[180px] flex-col gap-px overflow-y-auto px-2">
            {others.map((u) => (
              <button key={u.id} onClick={() => add(u.id)} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.05]">
                <Avatar id={u.id} name={u.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{u.name}</span>
                <UserPlus className="size-4 text-ink-3 group-hover:text-accent" />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-between gap-2 border-t border-line pt-4">
        <Button variant="danger" onClick={leave}>
          <LogOut className="size-4" />
          Quitter le canal
        </Button>
        <Button onClick={onClose}>Fermer</Button>
      </div>
    </Modal>
  );
}
