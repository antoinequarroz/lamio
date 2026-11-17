import type { MetadataRoute } from "next";

// Lets Cordée be installed as an app: "Ajouter au Dock" on Mac, "Sur l'écran d'accueil" on iPhone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cordée",
    short_name: "Cordée",
    description: "La messagerie d'équipe et le socle de la suite.",
    start_url: "/c",
    display: "standalone",
    background_color: "#efede8",
    theme_color: "#efede8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
