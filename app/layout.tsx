import type { Metadata } from "next";
import { Charm, IBM_Plex_Sans_Thai } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const thai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-thai",
});

const charm = Charm({
  subsets: ["thai", "latin"],
  weight: ["700"],
  variable: "--font-charm",
});

export const metadata: Metadata = {
  title: "Canteen มีอารายกิน",
  description: "จัดการเมนูโรงอาหารรายเดือน ส่งเข้า LINE พร้อมปุ่มให้คะแนนเมนูและรสชาติ",
  applicationName: "Canteen มีอารายกิน",
  appleWebApp: { capable: true, title: "มีอารายกิน", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/brand/canteen-logo.jpg", type: "image/jpeg" }],
    apple: [{ url: "/brand/apple-touch.png", type: "image/png" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#06BB46",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={`${thai.variable} ${charm.variable} ${thai.className} antialiased`}>
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
