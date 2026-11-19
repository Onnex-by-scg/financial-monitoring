import type { Metadata } from "next";
import SettingsApp from "@/components/settings/SettingsApp";

export const metadata: Metadata = { title: "Settings · Financial Monitoring" };

export default function SettingsPage() {
  return <SettingsApp />;
}
