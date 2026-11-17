# Cordée

La messagerie de l'équipe, et la base de la suite. Canaux, messages directs, fichiers : c'est ici qu'on se parle, et c'est ici que les autres outils viennent se brancher.

Cordée fait partie de la même suite que [Cairn](https://github.com/antoinequarroz/Cairn) (notes et coffre), [Metricove](https://github.com/antoinequarroz/metricove_v2) (réseaux sociaux) et [Alfred](https://github.com/antoinequarroz/Alfred) (calendrier) : même stack, même design, une autre couleur. Ici, le violet.

![La messagerie, en clair](docs/img/clair.png)
![La messagerie, en sombre](docs/img/sombre.png)

## Ce qui marche aujourd'hui

- **Comptes** : la première personne qui ouvre l'app crée son compte et devient administratrice. Elle ajoute ensuite les membres dans Réglages.
- **Canaux** : ouverts à toute l'équipe, créés en deux clics. `#general` existe dès le départ.
- **Messages directs** : à une personne, ou à soi-même pour garder une note.
- **Fichiers** : par le trombone, en glisser-déposer ou en collant. Les images s'affichent dans la conversation.
- **En direct** : les messages arrivent sans recharger la page, avec les compteurs de non lus.
- **Recherche ⌘K** : aller à un canal, une personne, une action.
- **Modules** : la liste des outils de la suite, et ceux qui sont branchés.
- **Clair et sombre** : comme l'appareil, ou forcé dans Réglages.
- **Installable** comme une app sur Mac (Safari, « Ajouter au Dock ») et sur iPhone (« Sur l'écran d'accueil »).

## Lancer en local

```bash
pnpm install
pnpm dev
```

Puis ouvrir http://localhost:3000 et créer le premier compte.

```bash
pnpm test    # comptes, conversations, messages, fichiers, modules
pnpm lint
pnpm build
```

## Configuration

Copier `.env.example` en `.env.local` (en local) ou `.env` (sur le VPS). Rien n'est obligatoire.

| Variable | Rôle |
| --- | --- |
| `DATA_DIR` | Dossier de la base SQLite et des fichiers (`./data` par défaut). |
| `MAX_FILE_MB` | Taille maximale d'un fichier joint (25 Mo par défaut). |
| `CAIRN_URL`, `METRICOVE_URL`, `ALFRED_URL`, `NINO_URL` | Adresse d'un outil de la suite, pour le brancher. |

## Les modules

Tout est dans [`src/modules/registry.ts`](src/modules/registry.ts) : une entrée par outil. Trois états, comme dans la feuille de route :

1. **Actif** : fait partie de Cordée (la messagerie).
2. **Branché** : l'outil tourne à son adresse, Cordée l'ouvre. Il suffit de donner son adresse dans `.env`.
3. **Bientôt** : prévu, pas encore branché.

Les étapes suivantes (une seule connexion pour tous les outils, puis des échanges de données entre eux) partiront de ce fichier.

## Comment c'est fait

Next.js 15, React 19, Tailwind 4, SQLite (better-sqlite3). Un seul processus, une seule base : simple à héberger tant que l'usage est personnel.

| Dossier | Contenu |
| --- | --- |
| `src/server/db.ts` | Toute la base : comptes, sessions, conversations, messages, fichiers. Le seul endroit à réécrire pour passer à PostgreSQL. |
| `src/server/auth.ts`, `password.ts` | Sessions (cookie, jeton aléatoire dont seule l'empreinte est gardée) et mots de passe (scrypt). |
| `src/server/events.ts` | Les messages en direct, en mémoire. À remplacer par Postgres ou Redis le jour où il y a plusieurs serveurs. |
| `src/app/api` | L'API. Chaque route vérifie la session, et le droit de lire la conversation. |
| `src/lib/store.tsx` | L'état côté navigateur : moi, l'équipe, mes conversations, le flux en direct. |
| `src/components` | L'interface. `ui.tsx` contient les briques communes à la suite. |
| `src/app/globals.css` | Les couleurs et le thème, repris de Cairn et Metricove. |

## La suite

- Modifier un message, réactions, fils de réponses, mentions et notifications.
- Canaux privés (la table `members` est prête).
- Recherche dans les messages.
- Une seule connexion pour Cordée, Cairn et Metricove.
- Apps Mac (Tauri) et iOS, à partir du même code.

## Déploiement

`deploy/docker-compose.yml` lance Cordée sur le VPS derrière le Caddy déjà en place. Les données vivent dans le volume `cordee-data` (base et fichiers) : c'est lui qu'il faut sauvegarder.
