"use client";

import { Copy, Lock, LogOut, Trash2, UserMinus, UserPlus, Webhook as WebhookIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { Conversation, Webhook } from "@/lib/types";
import { api, cn, slugify } from "@/lib/utils";
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

/** A channel's settings: its name and description, and for a private one its members. */
export function ChannelDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const router = useRouter();
  const { users, me, reload } = useApp();
  const [name, setName] = useState(conversation.name);
  const [topic, setTopic] = useState(conversation.topic);
  const [busy, setBusy] = useState(false);
  const slug = slugify(name);
  const changed = slug !== conversation.name || topic.trim() !== conversation.topic;
  const members = users.filter((u) => conversation.memberIds?.includes(u.id));
  const others = users.filter((u) => !conversation.memberIds?.includes(u.id));
  const url = `/api/conversations/${conversation.id}`;

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await run(() => api(url, { method: "PATCH", json: { name, topic } }))) toast("Canal mis à jour");
    setBusy(false);
  };

  const remove = (userId: string, who: string) => window.confirm(`Retirer ${who} de #${conversation.name} ?`) && run(() => api(`${url}/members?userId=${encodeURIComponent(userId)}`, { method: "DELETE" }));

  const leave = async () => {
    const last = members.length === 1;
    if (!window.confirm(last ? `Tu es la dernière personne dans #${conversation.name} : en le quittant, le canal et ses messages seront supprimés. Continuer ?` : `Quitter #${conversation.name} ? Il faudra qu'un membre t'y ajoute à nouveau pour y revenir.`)) return;
    try {
      await api(`${url}/members`, { method: "DELETE" });
      onClose();
      router.push("/c");
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Modal title={`#${conversation.name}`} onClose={onClose}>
      {conversation.canManage && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <Field label="Nom" hint={slug && slug !== conversation.name ? `Il s'appellera #${slug}` : undefined}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} />
          </Field>
          <Field label="Description">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder="À quoi sert ce canal ?" className={inputClass} />
          </Field>
          <Button variant="primary" className="self-start" disabled={busy || !slug || !changed}>
            Enregistrer
          </Button>
        </form>
      )}

      {conversation.canManage && <Webhooks conversation={conversation} />}

      {conversation.private && (
        <div className={cn(conversation.canManage && "mt-4 border-t border-line pt-4")}>
          <span className="text-[12px] font-medium text-ink-2">
            {members.length} {members.length > 1 ? "membres" : "membre"}
          </span>
          <ul className="scroll-thin -mx-2 mt-1.5 flex max-h-[200px] flex-col gap-px overflow-y-auto px-2">
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
                {conversation.canManage && u.id !== me.id && (
                  <Button size="sm" variant="ghost" onClick={() => remove(u.id, u.name)} aria-label={`Retirer ${u.name}`}>
                    <UserMinus className="size-3.5" />
                    Retirer
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {others.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <span className="text-[12px] font-medium text-ink-2">Ajouter quelqu&apos;un</span>
              <div className="scroll-thin -mx-2 mt-1.5 flex max-h-[160px] flex-col gap-px overflow-y-auto px-2">
                {others.map((u) => (
                  <button key={u.id} onClick={() => run(() => api(`${url}/members`, { method: "POST", json: { userId: u.id } }))} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.05]">
                    <Avatar id={u.id} name={u.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{u.name}</span>
                    <UserPlus className="size-4 text-ink-3 group-hover:text-accent" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-between gap-2 border-t border-line pt-4">
        {conversation.private ? (
          <Button variant="danger" onClick={leave}>
            <LogOut className="size-4" />
            Quitter le canal
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onClose}>Fermer</Button>
      </div>
    </Modal>
  );
}

/**
 * The incoming webhooks of a channel: another tool (Orbi's alerts…) posts here with a secret
 * address. The address is shown once, right after it is created.
 */
function Webhooks({ conversation }: { conversation: Conversation }) {
  const { reload } = useApp();
  const [list, setList] = useState<Webhook[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; url: string } | null>(null);
  const url = `/api/conversations/${conversation.id}/webhooks`;

  const load = useCallback(() => api<Webhook[]>(url).then(setList, (e) => toast.error((e as Error).message)), [url]);
  useEffect(() => void load(), [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const hook = await api<Webhook & { url: string }>(url, { method: "POST", json: { name } });
      setCreated({ name: hook.name, url: hook.url });
      setName("");
      await Promise.all([load(), reload()]);
    } catch (err) {
      toast.error((err as Error).message);
    }
    setBusy(false);
  };

  const remove = async (hook: Webhook) => {
    if (!window.confirm(`Supprimer le webhook ${hook.name} ? Son adresse cessera de fonctionner tout de suite.`)) return;
    try {
      await api(`/api/webhooks/${hook.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Adresse copiée");
    } catch {
      toast.error("Copie impossible : sélectionne l'adresse à la main");
    }
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      <span className="text-[12px] font-medium text-ink-2">Webhooks entrants</span>
      <p className="mt-0.5 text-[12px] text-ink-3">Une autre application (les alertes d&apos;Orbi par exemple) écrit dans ce canal avec une adresse secrète.</p>
      {list && list.length > 0 && (
        <ul className="-mx-2 mt-1.5 flex flex-col gap-px px-2">
          {list.map((h) => (
            <li key={h.id} className="flex items-center gap-2.5 px-2 py-1.5">
              <WebhookIcon className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium leading-tight">{h.name}</span>
                <span className="block truncate text-[12px] leading-tight text-ink-3">{h.lastUsedAt ? `Dernier message le ${new Date(h.lastUsedAt).toLocaleString("fr-CH")}` : "Pas encore utilisé"}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => remove(h)} aria-label={`Supprimer ${h.name}`}>
                <Trash2 className="size-3.5" />
                Supprimer
              </Button>
            </li>
          ))}
        </ul>
      )}
      {created && (
        <div className="mt-2 rounded-lg border border-line-strong bg-surface-2 p-2.5">
          <p className="text-[12px] text-ink-2">Adresse de {created.name}, à copier maintenant : elle ne sera plus affichée.</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-[12px] select-all">{created.url}</code>
            <Button size="sm" onClick={() => copy(created.url)} aria-label="Copier l'adresse">
              <Copy className="size-3.5" />
              Copier
            </Button>
          </div>
        </div>
      )}
      <form onSubmit={add} className="mt-2 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Nom, par exemple Orbi" className={inputClass} />
        <Button disabled={busy || !name.trim()}>Ajouter</Button>
      </form>
    </div>
  );
}
