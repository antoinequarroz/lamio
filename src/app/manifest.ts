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
    // The dark variant is the approved one for installed icons, whatever the page's theme.
    icons: [
      { src: "/brand/lamio/app-dark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/lamio/app-dark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/lamio/maskable-dark-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/lamio/maskable-dark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
