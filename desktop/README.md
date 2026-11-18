# Lamio pour Mac

Une vraie app Mac (icône dans le Dock, fenêtre à elle) qui ouvre le Lamio en ligne. Elle n'embarque qu'une page d'attente : quand le serveur est mis à jour, l'app l'est aussi. Si le serveur est injoignable, elle le dit et réessaie toute seule. Faite avec [Tauri](https://tauri.app), elle pèse quelques Mo.

Les liens vers Cairn, Metricove ou un site cité dans un message s'ouvrent dans le navigateur.

## Construire l'app

Il faut Xcode, Rust (`rustup`) et Node.

```bash
cd desktop
npm install
npm run build
```

L'app est dans `src-tauri/target/release/bundle/macos/Lamio.app`, et l'image disque à partager dans `src-tauri/target/release/bundle/dmg/`. La première construction prend quelques minutes.

Pour viser un autre serveur que https://lamio.postmelo.ch :

```bash
LAMIO_URL=https://lamio.exemple.ch npm run build
```

## L'app iPhone

Le même code donne l'app iPhone : la page d'attente, puis le Lamio en ligne. Les liens vers les autres outils s'ouvrent dans Safari, et la connexion par le Compte Postmelo reste dans l'app.

Il faut en plus les cibles iOS de Rust et CocoaPods :

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
brew install cocoapods
```

Puis, dans `desktop/` :

```bash
npm install
npm run ios:init                    # une fois : crée le projet Xcode dans src-tauri/gen/apple
npm run ios:dev -- "iPhone 16"      # lance l'app dans le simulateur
```

L'identifiant de l'app iPhone est `ch.postmelo.lamio` (`src-tauri/tauri.ios.conf.json`). Pour l'installer sur un vrai iPhone ou la publier, il faut un compte développeur Apple.

## À savoir

- L'app n'est pas signée par Apple. Sur ton Mac, celle que tu construis s'ouvre normalement. Sur le Mac de quelqu'un d'autre, il faut un clic droit puis « Ouvrir » la première fois, ou un compte développeur Apple pour la signer.
- Les notifications de l'appareil ne passent pas encore dans cette app (la fenêtre n'a pas l'interface de notification des navigateurs). Les notifications dans l'app marchent.
- L'icône se refait avec `npm run icons` à partir de `icon.png`.
