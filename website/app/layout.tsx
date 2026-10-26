import type { Metadata } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import { Nav } from "@/components/nav";
import { Toaster } from "@/components/ui";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-deva", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Gita Stories",
  description: "Find, review and fix the stories Rohit tells in his Gita classes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${deva.variable}`}>
      <body className="min-h-screen font-sans text-sm">
        <Nav />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
