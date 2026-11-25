# Mettre Lamio en ligne sur le VPS

À la fin de ce guide : **https://lamio.postmelo.ch**, avec ton compte d'administrateur, et Cairn et Metricove qui s'ouvrent avec ce compte.

Lamio est en ligne depuis le 17 novembre 2026. Ce guide décrit ce qui a été fait, pour le refaire ou le dépanner.

Lamio a d'abord vécu sur `lamio.antoinequarroz.ch`. Cette adresse renvoie maintenant vers la nouvelle (voir « Ancienne adresse » plus bas).

## 0. Comment c'est branché

- Le Caddy du VPS est le conteneur `antoinequarroz-caddy`. Il tient les ports 80 et 443 et sert tous les sites.
- Son Caddyfile est `~/.config/antoinequarroz-vitrine/runtime/Caddyfile` (pas celui d'un dépôt).
- Les apps rejoignent le réseau Docker `antoinequarroz-vitrine_appnet`, et Caddy les joint par le nom de leur conteneur. Lamio ne publie donc aucun port sur le VPS.

## 1. DNS

Un enregistrement **A** `lamio` vers l'IP du VPS, dans la zone `postmelo.ch` chez Infomaniak (il n'y a pas d'enregistrement générique). Pour vérifier : `dig +short lamio.postmelo.ch`.

## 2. Installer Lamio

```bash
git clone https://github.com/antoinequarroz/lamio ~/lamio
cd ~/lamio
cp .env.example .env && chmod 600 .env
nano .env
```

Rien n'est obligatoire pour démarrer. Pour afficher Cairn et Metricove dans « Modules » :

```env
CAIRN_URL=https://cairn.antoinequarroz.ch
METRICOVE_URL=https://social.antoinequarroz.ch
```

Puis :

```bash
cd deploy
docker compose up -d --build
```

Le conteneur s'appelle `lamio`. Pour vérifier : `docker ps --filter name=lamio` doit le montrer « healthy ».

## 3. Brancher Caddy

Garde d'abord une copie du Caddyfile, puis ajoute ce bloc à la fin :

```caddy
lamio.postmelo.ch {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
	# Fichiers joints jusqu'à 25 Mo
	request_body {
		max_size 30MB
	}
	reverse_proxy lamio:3000 {
		# Messages en direct : rien n'est retenu en chemin
		flush_interval -1
	}
}
```

Valide, puis recharge sans redémarrer :

```bash
docker exec antoinequarroz-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec antoinequarroz-caddy caddy reload --config /etc/caddy/Caddyfile
```

Le certificat HTTPS arrive en moins d'une minute. Si la validation échoue, remets la copie.

### Ancienne adresse

Pour que les anciens liens continuent de marcher, `lamio.antoinequarroz.ch` renvoie pour de bon vers la nouvelle adresse, en gardant le chemin. Son enregistrement DNS reste en place, et son bloc dans le Caddyfile devient :

```caddy
lamio.antoinequarroz.ch {
	redir https://lamio.postmelo.ch{uri} permanent
}
```

À savoir après un changement d'adresse :

- Chacun se reconnecte une fois : la session est liée à l'adresse.
- L'app Mac se reconstruit (`cd desktop && npm run build`), car elle n'ouvre dans sa fenêtre que l'adresse choisie à la construction.
- Dans le `.env` de chaque outil branché (Cairn, Metricove, TickUp), `LAMIO_URL` prend la nouvelle adresse. Les secrets ne changent pas.

## 4. Premier lancement

1. Ouvre https://lamio.postmelo.ch **tout de suite** et crée ton compte : la première personne qui arrive devient administratrice.
2. Dans **Réglages**, ajoute les membres.
3. Sur Mac : Safari, Fichier, « Ajouter au Dock ». Sur iPhone : Partager, « Sur l'écran d'accueil ».

## 5. Une seule connexion pour Cairn et Metricove

Cairn et Metricove doivent être à jour (ils ont le bouton « Se connecter avec Lamio » depuis leur version de novembre 2026).

Un secret par outil. Sur le VPS :

```bash
openssl rand -base64 32   # une fois pour Cairn
openssl rand -base64 32   # une fois pour Metricove
```

Dans `~/lamio/.env` :

```env
CAIRN_URL=https://cairn.antoinequarroz.ch
CAIRN_SSO_SECRET=<le secret de Cairn>
METRICOVE_URL=https://social.antoinequarroz.ch
METRICOVE_SSO_SECRET=<le secret de Metricove>
```

Dans `~/cairn/.env` :

```env
LAMIO_URL=https://lamio.postmelo.ch
LAMIO_SSO_SECRET=<le secret de Cairn>
```

Dans `~/metricove/.env` :

```env
LAMIO_URL=https://lamio.postmelo.ch
LAMIO_SSO_SECRET=<le secret de Metricove>
```

Relance les trois (`docker compose up -d` dans le dossier `deploy` de chacun).

Ensuite, dans Lamio, « Modules » ouvre Cairn et Metricove sans mot de passe. Les administrateurs y entrent toujours. Pour un membre, c'est le bouton **Accès** de chaque module qui décide. Le mot de passe de chaque outil continue de marcher.

À savoir : Cairn et Metricove n'ont qu'un seul espace. Une personne à qui tu ouvres Cairn voit donc toutes tes notes (le coffre reste fermé par son mot de passe maître).

## Brancher Lamio sur le Compte Postmelo

Le Compte Postmelo (dépôt `postmelo-compte`, en ligne sur `https://compte.postmelo.ch`) est le compte unique de la suite.
Une fois branché, la page de connexion de Lamio propose « Continuer avec mon Compte Postmelo ». Le mot de passe Lamio reste là en secours.

Un secret, créé sur le VPS avec `openssl rand -base64 32`, à mettre des deux côtés.

Dans `~/compte/.env` :

```env
LAMIO_URL=https://lamio.postmelo.ch
LAMIO_CLIENT_SECRET=<le secret>
```

Dans `~/lamio/.env` :

```env
COMPTE_URL=https://compte.postmelo.ch
COMPTE_CLIENT_SECRET=<le même secret>
APP_URL=https://lamio.postmelo.ch
```

Relance les deux, le compte d'abord (`docker compose up -d` dans `~/compte/deploy`, puis `docker compose up -d --build` dans `~/lamio/deploy`).

À savoir :

- La personne est retrouvée par son identifiant (les comptes repris de Lamio ont gardé le leur), sinon par son e-mail. Une personne inconnue de Lamio y est créée à sa première connexion, sans mot de passe Lamio.
- Le nom et le rôle (admin ou membre) suivent ceux du Compte Postmelo à chaque connexion.
- « Se déconnecter » ferme aussi la session du Compte Postmelo.
- Retour en arrière : vide les trois lignes de `~/lamio/.env` et relance Lamio. Tout redevient comme avant.
- L'app Mac doit être reconstruite une fois (`desktop/`), pour que la connexion par le Compte Postmelo reste dans sa fenêtre. En attendant, le mot de passe Lamio y fonctionne toujours.

## 6. Sauvegardes

```bash
~/lamio/deploy/backup.sh                 # écrit dans ~/lamio-backups, garde les 14 dernières
```

Chaque nuit à 3 h 15, avec cron (`crontab -e`) :

```cron
15 3 * * * $HOME/lamio/deploy/backup.sh >> $HOME/lamio-backups.log 2>&1
```

Copie ensuite ce dossier **hors du VPS**. L'archive contient la base (`backup.db` : comptes, conversations, messages) et les fichiers joints.

Pour restaurer : arrête Lamio, décompresse l'archive dans le volume `app-data` en renommant `backup.db` en `app.db`, relance.

## 7. Mettre à jour

```bash
cd ~/lamio && git pull
cd deploy && docker compose up -d --build
```

Les données sont dans le volume Docker `app-data`, elles ne bougent pas.

## Mails (onglet Mails, en cours)

Lamio peut se brancher sur la boîte mail de chacun (Infomaniak par défaut, ou tout serveur IMAP/SMTP), dans Réglages › Mails. Le mot de passe de la boîte est chiffré dans la base avec une clé qui reste dans le `.env`.

Dans `~/lamio/.env` (faire d'abord une copie : `cp .env .env.bak-$(date +%F)`) :

```env
MAIL_SECRET=<openssl rand -base64 32>
```

Puis `cd ~/lamio/deploy && docker compose up -d --build`. Sans `MAIL_SECRET`, la section Mails affiche « pas encore activé » et rien d'autre ne change.

- Ne change plus cette clé ensuite : les boîtes déjà branchées devraient être rebranchées (le mot de passe ne se déchiffre plus).
- La sauvegarde de 3h15 contient la copie locale des mails (en-têtes et aperçus) et le mot de passe chiffré, jamais la clé.
- Lamio refuse les serveurs du réseau privé (localhost, réseau Docker) et n'accepte que les ports 993/143 (IMAP) et 465/587 (SMTP).
