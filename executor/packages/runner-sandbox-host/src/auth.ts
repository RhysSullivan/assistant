/** Constant-time string comparison to prevent timing side-channels. */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  const maxLength = Math.max(bufA.length, bufB.length);
  let result = bufA.length ^ bufB.length;
  for (let i = 0; i < maxLength; i++) {
    result |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return result === 0;
}

export function authorizeRunRequest(request: Request, authToken: string): Response | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice("Bearer ".length);
  if (!timingSafeEqual(token, authToken)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
