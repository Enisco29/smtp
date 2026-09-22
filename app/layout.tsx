import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Relaycraft", template: "%s · Relaycraft" },
  description: "Thoughtful, personalized email outreach with your own Gmail account.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
