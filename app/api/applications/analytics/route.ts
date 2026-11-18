import { getD1 } from "@/lib/database";
import { applicationAnalytics } from "@/lib/application-analytics";
import { applicationError } from "@/lib/applications";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await applicationAnalytics(getD1()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return applicationError(error);
  }
}
