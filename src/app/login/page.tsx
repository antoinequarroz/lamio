"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Button, inputClass } from "@/components/ui";
import { api, APP_NAME, safeNext } from "@/lib/utils";

export default function LoginPage() {
  /** No account yet: the first person to arrive creates theirs and becomes admin. */
  const [setup, setSetup] = useState<boolean | null>(null);
  /** The Compte Postmelo is plugged in: it is the way in, the Lamio password stays as a spare key. */
  const [compte, setCompte] = useState(false);
  const [spare, setSpare] = useState(false);
  const [next, setNext] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // With a time limit: a request that never answers must not leave the page empty.
    const params = new URLSearchParams(window.location.search);
    setNext(params.get("next") ?? "");
    setError(params.get("erreur") ?? "");
    api<{ needsSetup: boolean; compte?: boolean }>("/api/auth/status", { signal: AbortSignal.timeout(6000) }).then(
      (s) => {
        setCompte(!!s.compte);
        setSetup(s.needsSetup);
      },
      () => setSetup(false),
    );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", json: { name, email, password } });
      // Coming from a tool of the suite ("Se connecter avec Lamio"): go on with that sign-in.
      window.location.href = safeNext(new URLSearchParams(window.location.search).get("next"));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  // Until the server says whether an account exists: the logo, rather than an empty page.
  if (setup === null)
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Logo className="size-9 animate-pulse" />
      </div>
    );

  if (compte && !spare)
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="rise w-full max-w-[360px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl">
          <Logo className="size-9" />
          <h1 className="mt-5 font-display text-[30px] leading-none">{APP_NAME}</h1>
          <p className="mt-2 text-[13px] text-ink-3">Connecte-toi avec ton Compte Postmelo, le même pour tous tes outils.</p>
          {error && <p className="mt-4 text-[12.5px] text-danger">{error}</p>}
          <Button variant="primary" className="mt-6 w-full" onClick={() => (window.location.href = `/api/auth/compte/start${next ? `?next=${encodeURIComponent(next)}` : ""}`)}>
            Continuer avec mon Compte Postmelo
          </Button>
          {!setup && (
            <button type="button" onClick={() => (setSpare(true), setError(""))} className="mt-4 w-full text-center text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
              Utiliser mon mot de passe Lamio
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="rise w-full max-w-[360px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl">
        <Logo className="size-9" />
        <h1 className="mt-5 font-display text-[30px] leading-none">{APP_NAME}</h1>
        <p className="mt-2 text-[13px] text-ink-3">{setup ? "Bienvenue. Crée ton compte : ce sera celui de l'administrateur." : "Connecte-toi pour retrouver ton équipe."}</p>
        <div className="mt-6 flex flex-col gap-2.5">
          {setup && <input autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ton nom" maxLength={80} className={inputClass} />}
          <input type="email" autoFocus={!setup} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className={inputClass} />
          <input type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={setup ? "Mot de passe (10 caractères au moins)" : "Mot de passe"} className={inputClass} />
        </div>
        {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="mt-4 w-full" disabled={busy || !email || !password || (setup && (!name.trim() || password.length < 10))}>
          {busy ? "Un instant…" : setup ? "Créer mon compte" : "Se connecter"}
        </Button>
        {compte && (
          <button type="button" onClick={() => (setSpare(false), setError(""))} className="mt-4 w-full text-center text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Revenir au Compte Postmelo
          </button>
        )}
      </form>
    </div>
  );
}
