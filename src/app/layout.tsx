import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Local SEO Autopilot", template: "%s · Local SEO Autopilot" },
  description: "AI-powered Local SEO automation platform for agencies",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-[14px]">{children}</body>
    </html>
  );
}
