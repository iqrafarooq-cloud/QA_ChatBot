import { Geist, Geist_Mono } from "next/font/google";
import "highlight.js/styles/github-dark.css";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "QA ChatBot",
  description: "Your intelligent AI companion for software quality assurance.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#111a2e" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
