# Mettre Lamio en ligne sur le VPS

À la fin de ce guide : **https://lamio.antoinequarroz.ch**, avec ton compte d'administrateur, et Cairn et Metricove qui s'ouvrent avec ce compte.

Ce guide n'a pas encore été déroulé sur le VPS : les commandes sont celles de Cairn et Metricove, adaptées. Si une étape coince, c'est probablement la 3 (le lien avec le Caddy de Metricove).

## 0. Prérequis

- Docker et le plugin compose (`docker compose version`).
- Metricove déjà en ligne sur ce VPS : son Caddy tient les ports 80 et 443, Lamio passe par lui.

## 1. DNS

Un enregistrement **A** `lamio` qui pointe vers l'IP du VPS. Pour vérifier : `dig +short lamio.antoinequarroz.ch`.

## 2. Installer Lamio

```bash
git clone https://github.com/antoinequarroz/lamio ~/lamio
cd ~/lamio
cp .env.example .env
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

Lamio écoute maintenant sur `172.17.0.1:3030` : joignable par les autres conteneurs du VPS, pas depuis Internet. Pour vérifier : `curl -I http://172.17.0.1:3030/login` doit répondre `200`.

## 3. Brancher le Caddy de Metricove

Dans `~/metricove/deploy/Caddyfile`, ajoute :

```caddy
lamio.antoinequarroz.ch {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	# Fichiers joints jusqu'à 25 Mo
	request_body {
		max_size 30MB
	}
	reverse_proxy host.docker.internal:3030 {
		# Messages en direct : rien n'est retenu en chemin
		flush_interval -1
	}
}
```

Puis recharge Caddy :

```bash
cd ~/metricove/deploy
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Le certificat HTTPS arrive en moins d'une minute.

Si Caddy répond « 502 » : `host.docker.internal` ne correspond pas à `172.17.0.1` sur ce VPS. Cherche la bonne adresse avec `docker compose exec caddy getent hosts host.docker.internal`, mets-la dans `APP_BIND` (`~/lamio/deploy/.env`), puis relance `docker compose up -d` côté Lamio.

## 4. Premier lancement

1. Ouvre https://lamio.antoinequarroz.ch **tout de suite** et crée ton compte : la première personne qui arrive devient administratrice.
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
LAMIO_URL=https://lamio.antoinequarroz.ch
LAMIO_SSO_SECRET=<le secret de Cairn>
```

Dans `~/metricove/.env` :

```env
LAMIO_URL=https://lamio.antoinequarroz.ch
LAMIO_SSO_SECRET=<le secret de Metricove>
```

Relance les trois (`cd deploy && docker compose up -d` dans chaque dossier).

Ensuite, dans Lamio, « Modules » ouvre Cairn et Metricove sans mot de passe. Les administrateurs y entrent toujours. Pour un membre, c'est le bouton **Accès** de chaque module qui décide. Le mot de passe de chaque outil continue de marcher.

À savoir : Cairn et Metricove n'ont qu'un seul espace. Une personne à qui tu ouvres Cairn voit donc toutes tes notes (le coffre reste fermé par son mot de passe maître).

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
