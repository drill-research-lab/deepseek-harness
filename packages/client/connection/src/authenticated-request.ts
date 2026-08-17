import type { IncomingMessage } from 'node:http'

/**
 * Remove browser cookies after Host authentication so transport and runtime
 * consumers receive only the request-local AuthenticatedUser.
 * @param request - authenticated HTTP or WebSocket request entering dispatch.
 */
export function removeBrowserCookies(request: IncomingMessage): void {
  delete request.headers.cookie
  if (!Array.isArray(request.rawHeaders)) return
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'cookie') request.rawHeaders.splice(index, 2)
  }
}
