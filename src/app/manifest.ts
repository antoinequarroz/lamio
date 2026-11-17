import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

// Lets the app be installed as an app: "Ajouter au Dock" on Mac, "Sur l'écran d'accueil" on iPhone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: "/c",
    display: "standalone",
    background_color: "#efede8",
    theme_color: "#efede8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
