import FinancialDashboard from "@/components/FinancialDashboard";
import { PageTransition } from "@/components/PageTransition";

export const metadata = { title: "Financial Performance · ONNEX by SCG" };

export default function FinancialPage() {
  return (
    <PageTransition>
      <FinancialDashboard />
    </PageTransition>
  );
}
