import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Printshop — coming soon",
  description: "3D-printed goods, made to order.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
