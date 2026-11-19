import { route } from "@/lib/peak/route-helpers";
import { publicSettings } from "@/lib/peak/settings-store";

// GET /api/settings -> developer credentials and companies, with secrets masked.
export const GET = route(async () => publicSettings());
