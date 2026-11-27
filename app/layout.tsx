import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const hindi = Noto_Sans_Devanagari({ variable: "--font-hindi", subsets: ["devanagari"], weight: ["400", "500", "600", "700"] });
// Runs before paint, so a dark-theme user never sees a white flash. The saved choice wins, else the device setting.
const THEME = `try{document.documentElement.dataset.theme=localStorage.theme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}`;

export const metadata: Metadata = {
  title: "Curing Dashboard",
  description: "Sioplas 3 & 4 curing – Laser Power & Infra, Kharagpur",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${hindi.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
