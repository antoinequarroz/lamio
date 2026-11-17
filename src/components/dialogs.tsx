"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { api, slugify } from "@/lib/utils";
import { Avatar, Button, Field, inputClass, Modal } from "./ui";

export function NewChannelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { reload } = useApp();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const slug = slugify(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>("/api/conversations", { method: "POST", json: { kind: "channel", name, topic } });
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
