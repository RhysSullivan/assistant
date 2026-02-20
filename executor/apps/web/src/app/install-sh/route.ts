export function GET(request: Request): Response {
  return Response.redirect(new URL("/install", request.url), 302);
}
