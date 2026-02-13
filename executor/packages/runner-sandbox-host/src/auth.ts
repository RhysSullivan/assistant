/** Constant-time string comparison to prevent timing side-channels. */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing consistent, then return false.
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= (bufA[i] ?? 0) ^ (bufA[i] ?? 0);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
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
