import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SHV POS",
    short_name: "SHV POS",
    description: "Speedyhive Cloud POS for sales, stock, staff and branch management.",
    start_url: "/app/dashboard",
    display: "standalone",
    background_color: "#eef3f0",
    theme_color: "#0b2d22",
    orientation: "portrait-primary",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icons/shv-pos-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/shv-pos-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
