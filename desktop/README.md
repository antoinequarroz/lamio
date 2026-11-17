# Lamio pour Mac

Une vraie app Mac (icône dans le Dock, fenêtre à elle) qui ouvre le Lamio en ligne. Rien n'est embarqué : quand le serveur est mis à jour, l'app l'est aussi. Faite avec [Tauri](https://tauri.app), elle pèse quelques Mo.

Les liens vers Cairn, Metricove ou un site cité dans un message s'ouvrent dans le navigateur.

## Construire l'app

Il faut Xcode, Rust (`rustup`) et Node.

```bash
cd desktop
npm install
npm run build
```

L'app est dans `src-tauri/target/release/bundle/macos/Lamio.app`, et l'image disque à partager dans `src-tauri/target/release/bundle/dmg/`. La première construction prend quelques minutes.

Pour viser un autre serveur que https://lamio.antoinequarroz.ch :

```bash
LAMIO_URL=https://lamio.exemple.ch npm run build
```

## À savoir

- L'app n'est pas signée par Apple. Sur ton Mac, celle que tu construis s'ouvre normalement. Sur le Mac de quelqu'un d'autre, il faut un clic droit puis « Ouvrir » la première fois, ou un compte développeur Apple pour la signer.
- Les notifications de l'appareil ne passent pas encore dans cette app (la fenêtre n'a pas l'interface de notification des navigateurs). Les notifications dans l'app marchent.
- L'icône se refait avec `npm run icons` à partir de `icon.png`.
