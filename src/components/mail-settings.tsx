"use client";

import { AtSign, CheckCircle2, ChevronDown, Loader2, Mail, Plus, RefreshCw, Trash2, TriangleAlert, Unplug, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { MailAccountInfo, MailFolder, MailIdentity, MailNotify } from "@/lib/types";
import { api, cn } from "@/lib/utils";

type State = { enabled: boolean; account: MailAccountInfo | null };

const INFOMANIAK = { imapHost: "mail.infomaniak.com", imapPort: 993, smtpHost: "mail.infomaniak.com", smtpPort: 465 };

function since(iso: string | null) {
  if (!iso) return "jamais";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return new Date(iso).toLocaleString("fr-CH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Réglages › Mails: plug in the Infomaniak mailbox (or any IMAP/SMTP one), see how the sync goes. */
export function MailSettings() {
  const { listen } = useApp();
  const [state, setState] = useState<State | null>(null);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const next = await api<State>("/api/mail/account").catch(() => null);
    if (!next) return;
    setState(next);
    if (next.account) setFolders((await api<{ folders: MailFolder[] }>("/api/mail/folders").catch(() => ({ folders: [] }))).folders);
  }, []);

  useEffect(() => {
    void load();
    return listen((e) => {
      if (e.type === "mail" || e.type === "resync") void load();
    });
  }, [load, listen]);

  if (!state) return null;
  if (!state.enabled)
    return (
      <Card className="flex flex-col gap-1">
        <Title hint="Pas encore activé sur ce serveur : il faut ajouter la clé MAIL_SECRET dans son fichier .env.">Mails</Title>
      </Card>
    );
  if (!state.account || editing) return <MailForm account={state.account} onDone={() => (setEditing(false), void load())} onCancel={state.account ? () => setEditing(false) : undefined} />;
  return <MailStatusCard account={state.account} folders={folders} onEdit={() => setEditing(true)} onChange={load} />;
}

function Title({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-[15px] font-medium">
        <Mail className="size-4 text-accent" />
        {children}
      </h2>
      {hint && <p className="mt-1 text-[13px] text-ink-3">{hint}</p>}
    </div>
  );
}

function MailStatusCard({ account, folders, onEdit, onChange }: { account: MailAccountInfo; folders: MailFolder[]; onEdit: () => void; onChange: () => void }) {
  const [busy, setBusy] = useState<"sync" | "unplug" | null>(null);
  const inbox = folders.find((f) => f.specialUse === "\\Inbox");
  const syncing = account.status === "pending" || account.status === "syncing" || busy === "sync";

  const sync = async () => {
    setBusy("sync");
    try {
      await api("/api/mail/sync", { method: "POST" });
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const unplug = async () => {
    if (!window.confirm(`Débrancher ${account.email} de Lamio ? Ta boîte mail elle-même n'est pas touchée.`)) return;
    setBusy("unplug");
    try {
      await api("/api/mail/account", { method: "DELETE" });
      toast("Boîte mail débranchée", { description: "Le mot de passe et la copie locale ont été effacés." });
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <Title hint={account.email}>Mails</Title>
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]",
          account.status === "ok" && "border-line bg-surface-2",
          syncing && "border-line bg-surface-2",
          (account.status === "error" || account.status === "auth") && !syncing && "border-danger/30 bg-danger/5",
        )}
      >
        {syncing ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />
        ) : account.status === "ok" ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        )}
        <div className="min-w-0 flex-1">
          {syncing ? (
            <p>Synchronisation en cours… La première fois, cela peut prendre une minute sur une grosse boîte.</p>
          ) : account.status === "ok" ? (
            <p>
              Branchée et synchronisée {since(account.syncedAt)}.
              {inbox && (
                <span className="text-ink-3">
                  {" "}
                  Boîte de réception : {inbox.total.toLocaleString("fr-CH")} mails, dont {inbox.unread.toLocaleString("fr-CH")} non lus. {folders.length} dossiers.
                </span>
              )}
            </p>
          ) : (
            <p>
              {account.lastError ?? "La synchronisation a échoué."}
              {account.status === "auth" ? " Lamio ne réessaie plus seul : corrige le mot de passe." : " Lamio réessaie toutes les 2 minutes."}
            </p>
          )}
        </div>
      </div>
      {account.status === "ok" && (
        <p className="-mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-3">
          <Zap className={cn("size-3.5", account.live ? "text-accent" : "text-ink-3")} />
          {account.live ? "Temps réel : un nouveau mail arrive ici en une ou deux secondes." : "Temps réel en cours de connexion…"}
        </p>
      )}
      <SignatureField initial={account.signature} />
      <IdentitiesField account={account} />
      <NotifyField initial={account.notify} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={sync} disabled={busy !== null}>
          <RefreshCw className={cn("size-4", busy === "sync" && "animate-spin")} />
          Synchroniser
        </Button>
        <Button onClick={onEdit} disabled={busy !== null} variant={account.status === "auth" ? "primary" : "secondary"}>
          {account.status === "auth" ? "Corriger le mot de passe" : "Modifier"}
        </Button>
        <Button onClick={unplug} disabled={busy !== null} variant="danger">
          <Unplug className="size-4" />
          Débrancher
        </Button>
      </div>
    </Card>
  );
}

/** The signature under new mails, saved when the field is left. */
function SignatureField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const save = async () => {
    if (value === saved) return;
    try {
      await api("/api/mail/signature", { method: "PUT", json: { signature: value } });
      setSaved(value);
      toast("Signature enregistrée");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <Field label="Signature" hint="Ajoutée sous chaque nouveau mail, réponse ou transfert.">
      <textarea value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => void save()} rows={3} maxLength={2000} placeholder={"Antoine Quarroz\nPostmelo"} className={cn(inputClass, "h-auto resize-y py-2 leading-snug")} />
    </Field>
  );
}

type Extra = Pick<MailIdentity, "address" | "name" | "signature">;

/**
 * Other addresses this mailbox receives (aliases): I can send from each, with its own name and
 * signature, and an answer leaves from the address the mail was sent to.
 */
function IdentitiesField({ account }: { account: MailAccountInfo }) {
  const initial = (account.identities ?? []).filter((i) => !i.primary).map(({ address, name, signature }) => ({ address, name, signature }));
  const [list, setList] = useState<Extra[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(list) !== saved;
  const edit = (n: number, patch: Partial<Extra>) => setList(list.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    try {
      const clean = list.filter((x) => x.address.trim());
      const r = await api<{ account: MailAccountInfo }>("/api/mail/identities", { method: "PUT", json: { identities: clean } });
      const next = r.account.identities.filter((i) => !i.primary).map(({ address, name, signature }) => ({ address, name, signature }));
      setList(next);
      setSaved(JSON.stringify(next));
      toast("Adresses d'envoi enregistrées");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    // Not a Field (a <label>): it holds several inputs and buttons.
    <div role="group" aria-labelledby="mail-identities" className="flex flex-col gap-1.5">
      <span id="mail-identities" className="text-[12px] font-medium text-ink-2">Autres adresses d&apos;envoi</span>
      <div className="flex flex-col gap-2">
        {list.map((x, n) => (
          <div key={n} className="flex flex-col gap-1.5 rounded-lg border border-line p-2">
            <div className="flex flex-wrap gap-1.5">
              <input value={x.address} onChange={(e) => edit(n, { address: e.target.value })} placeholder="contact@postmelo.ch" aria-label="Adresse" type="email" className={cn(inputClass, "w-auto min-w-[170px] flex-[3] basis-0")} />
              <input value={x.name} onChange={(e) => edit(n, { name: e.target.value })} placeholder="Nom affiché (facultatif)" aria-label="Nom affiché" className={cn(inputClass, "w-auto min-w-[130px] flex-[2] basis-0 max-sm:order-last max-sm:basis-full")} />
              <button onClick={() => setList(list.filter((_, i) => i !== n))} aria-label="Retirer cette adresse" title="Retirer" className="press flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
                <Trash2 className="size-4" />
              </button>
            </div>
            <textarea value={x.signature} onChange={(e) => edit(n, { signature: e.target.value })} rows={2} maxLength={2000} placeholder="Signature de cette adresse" aria-label="Signature de cette adresse" className={cn(inputClass, "h-auto resize-y py-2 leading-snug")} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setList([...list, { address: "", name: "", signature: "" }])} disabled={list.length >= 20}>
            {list.length ? <Plus className="size-4" /> : <AtSign className="size-4" />}
            Ajouter une adresse
          </Button>
          {dirty && (
            <Button variant="primary" onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
          )}
        </div>
      </div>
      <span className="text-[11.5px] text-ink-3">Des alias qui arrivent dans cette boîte : tu peux écrire depuis chacun, avec sa signature, et une réponse part de l&apos;adresse qui a reçu le mail. Le serveur d&apos;envoi doit les accepter (chez Infomaniak : alias de l&apos;adresse).</span>
    </div>
  );
}

const NOTIFY: { value: MailNotify; label: string }[] = [
  { value: "all", label: "Tous les mails" },
  { value: "important", label: "Important" },
  { value: "known", label: "Contacts connus" },
  { value: "off", label: "Aucun" },
];

function NotifyField({ initial }: { initial: MailNotify }) {
  const [value, setValue] = useState(initial);
  const pick = async (next: MailNotify) => {
    const before = value;
    setValue(next);
    try {
      await api("/api/mail/notify", { method: "PUT", json: { notify: next } });
    } catch (err) {
      setValue(before);
      toast.error((err as Error).message);
    }
  };
  return (
    // Not a <Field>: its <label> would pass every click inside to the first button.
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">Notifier un nouveau mail</span>
      <div role="radiogroup" aria-label="Notifier un nouveau mail" className="flex w-fit max-w-full flex-wrap rounded-lg border border-line-strong p-0.5">
        {NOTIFY.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => void pick(o.value)}
            className={cn("press h-8 rounded-md px-3 text-[13px]", value === o.value ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-ink/[0.04]")}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-[11.5px] text-ink-3">« Important » : l&apos;onglet Important de la boîte triée. « Contacts connus » : seulement les personnes à qui tu as déjà écrit. Vaut pour ce navigateur, l&apos;app Mac et l&apos;iPhone.</span>
    </div>
  );
}

function MailForm({ account, onDone, onCancel }: { account: MailAccountInfo | null; onDone: () => void; onCancel?: () => void }) {
  const [email, setEmail] = useState(account?.email ?? "");
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [username, setUsername] = useState(account && account.username !== account.email ? account.username : "");
  const [servers, setServers] = useState({
    imapHost: account?.imapHost ?? INFOMANIAK.imapHost,
    imapPort: String(account?.imapPort ?? INFOMANIAK.imapPort),
    smtpHost: account?.smtpHost ?? INFOMANIAK.smtpHost,
    smtpPort: String(account?.smtpPort ?? INFOMANIAK.smtpPort),
  });
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const keepsPassword = !!account && email.trim().toLowerCase() === account.email;
  const payload = () => ({ email, password, username: username.trim() || undefined, ...servers });

  const test = async () => {
    setBusy("test");
    try {
      await api("/api/mail/account/test", { method: "POST", json: payload() });
      toast("Connexion réussie", { description: "Les serveurs de réception et d'envoi acceptent ces identifiants." });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    try {
      await api("/api/mail/account", { method: "PUT", json: payload() });
      toast("Boîte mail branchée", { description: "La synchronisation commence." });
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ready = email.trim() && (password || keepsPassword);

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Title hint="Ta boîte Infomaniak dans Lamio. Tout ce que tu y feras se fera sur ta vraie boîte, et se retrouvera dans le webmail et sur ton iPhone.">Mails</Title>
        <Field label="Adresse e-mail">
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@postmelo.ch" className={inputClass} />
        </Field>
        <Field
          label="Mot de passe"
          hint={
            keepsPassword
              ? "Laisse vide pour garder le mot de passe enregistré."
              : "Idéalement un mot de passe d'application, créé dans ton espace Infomaniak (Sécurité). Il est chiffré sur le serveur de Lamio et n'est jamais renvoyé à ton navigateur."
          }
        >
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={keepsPassword ? "••••••••" : ""} className={inputClass} />
        </Field>
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1 self-start text-[12.5px] text-ink-3 hover:text-ink">
          <ChevronDown className={cn("size-3.5 transition-transform", advanced && "rotate-180")} />
          Serveurs (Infomaniak par défaut)
        </button>
        {advanced && (
          <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-3 sm:grid-cols-[1fr_96px]">
            <Field label="Serveur de réception (IMAP)">
              <input value={servers.imapHost} onChange={(e) => setServers({ ...servers, imapHost: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Port">
              <select value={servers.imapPort} onChange={(e) => setServers({ ...servers, imapPort: e.target.value })} className={inputClass}>
                <option value="993">993</option>
                <option value="143">143</option>
              </select>
            </Field>
            <Field label="Serveur d'envoi (SMTP)">
              <input value={servers.smtpHost} onChange={(e) => setServers({ ...servers, smtpHost: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Port">
              <select value={servers.smtpPort} onChange={(e) => setServers({ ...servers, smtpPort: e.target.value })} className={inputClass}>
                <option value="465">465</option>
                <option value="587">587</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Identifiant" hint="Seulement s'il diffère de l'adresse e-mail.">
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" className={inputClass} />
              </Field>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!ready || busy !== null}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            {busy === "save" ? "Connexion…" : account ? "Enregistrer" : "Brancher ma boîte"}
          </Button>
          <Button type="button" onClick={test} disabled={!ready || busy !== null}>
            {busy === "test" && <Loader2 className="size-4 animate-spin" />}
            Tester la connexion
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy !== null}>
              Annuler
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
