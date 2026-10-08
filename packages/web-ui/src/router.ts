export interface RouteMatch<R extends string> {
  route: R;
  params: Record<string, string>;
}

export interface RoutePattern<R extends string> {
  route: R;
  pattern: string;
}

const LEADING_HASH = /^#\/?/;

export function resolveRoute<R extends string>(
  hash: string,
  routes: Array<RoutePattern<R>>,
): RouteMatch<R> | null {
  const clean = hash.replace(LEADING_HASH, "");
  if (clean.length === 0) {
    return resolveRoute("#/contacts", routes);
  }
  for (const route of routes) {
    const patternParts = route.pattern.split("/").filter((part) => part.length > 0);
    const hashParts = clean.split("/").filter((part) => part.length > 0);
    if (patternParts.length !== hashParts.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < patternParts.length; index += 1) {
      const patternPart = patternParts[index] ?? "";
      const hashPart = hashParts[index] ?? "";
      if (patternPart.startsWith(":")) {
        params[patternPart.slice(1)] = decodeURIComponent(hashPart);
      } else if (patternPart !== hashPart) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { route: route.route, params };
    }
  }
  return null;
}

export type RouteKind = "chat-view" | "other";

export function routeKind(hash: string): RouteKind {
  if (hash.startsWith("#/chat/")) {
    return "chat-view";
  }
  return "other";
}
