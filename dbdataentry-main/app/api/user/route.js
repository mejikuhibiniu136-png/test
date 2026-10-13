export async function GET() {
  const username = process.env.DASHBOARD_USER || 'Admin';
  return Response.json({ username });
}
