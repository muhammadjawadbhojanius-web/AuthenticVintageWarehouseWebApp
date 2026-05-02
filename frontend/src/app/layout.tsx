import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegistrar } from "@/components/sw-register";

/* All font files are bundled in public/fonts — no network call at build or
   runtime. Paths below are relative to this file (src/app/layout.tsx). */

const outfit = localFont({
  src: "../../public/fonts/Outfit.woff2",
  variable: "--font-outfit",
  display: "swap",
  weight: "100 900",
});

const cormorant = localFont({
  src: [
    { path: "../../public/fonts/CormorantGaramond-Light.woff2",        weight: "300", style: "normal" },
    { path: "../../public/fonts/CormorantGaramond-Regular.woff2",       weight: "400", style: "normal" },
    { path: "../../public/fonts/CormorantGaramond-Medium.woff2",        weight: "500", style: "normal" },
    { path: "../../public/fonts/CormorantGaramond-SemiBold.woff2",      weight: "600", style: "normal" },
    { path: "../../public/fonts/CormorantGaramond-Bold.woff2",          weight: "700", style: "normal" },
    { path: "../../public/fonts/CormorantGaramond-LightItalic.woff2",   weight: "300", style: "italic" },
    { path: "../../public/fonts/CormorantGaramond-RegularItalic.woff2", weight: "400", style: "italic" },
    { path: "../../public/fonts/CormorantGaramond-MediumItalic.woff2",  weight: "500", style: "italic" },
    { path: "../../public/fonts/CormorantGaramond-SemiBoldItalic.woff2",weight: "600", style: "italic" },
    { path: "../../public/fonts/CormorantGaramond-BoldItalic.woff2",    weight: "700", style: "italic" },
  ],
  variable: "--font-cormorant",
  display: "swap",
  preload: false,
});

const jetbrainsMono = localFont({
  src: "../../public/fonts/JetBrainsMono.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
  preload: false,
});

export const metadata: Metadata = {
  title: "Authentic Vintage",
  description: "Warehouse bundle management",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#d97706",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${outfit.variable} ${cormorant.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
