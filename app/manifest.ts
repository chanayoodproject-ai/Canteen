import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Canteen มีอารายกิน",
    short_name: "มีอารายกิน",
    description: "เมนูโรงอาหารรายวัน ส่งเข้า LINE พร้อมให้คะแนน",
    start_url: "/",
    display: "standalone",
    background_color: "#06BB46",
    theme_color: "#06BB46",
    lang: "th",
    icons: [
      { src: "/brand/canteen-logo.jpg", sizes: "1500x1500", type: "image/jpeg", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/apple-touch.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
