import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { SidebarNav } from "@/components/sidebar-nav";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lark Bridge Dashboard",
  description: "Lark Claude Bridge — admin dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="flex h-full min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <SidebarNav />
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </body>
    </html>
  );
}
