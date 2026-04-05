import { handler, json } from "@/lib/api-handler";
import { getAuthFromCookies } from "@/lib/auth";

export const GET = handler({}, async () => {
  const auth = await getAuthFromCookies();
  return json({ auth });
});
