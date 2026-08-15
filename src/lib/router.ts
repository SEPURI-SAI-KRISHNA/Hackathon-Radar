import { useEffect, useState } from 'react';

/**
 * A router in 40 lines, because this app has three shapes of page and pulling
 * in react-router to express that would be more code than this file.
 *
 * `/h/<slug>` is the one that matters: without a URL per hackathon you cannot
 * send anyone a link to a specific event, and search engines see one page.
 */
export type Route =
  | { name: 'discover' }
  | { name: 'tracker' }
  | { name: 'sources' }
  | { name: 'detail'; slug: string };

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/tracker') return { name: 'tracker' };
  if (path === '/sources') return { name: 'sources' };
  const detail = path.match(/^\/h\/([^/]+)$/);
  if (detail) return { name: 'detail', slug: decodeURIComponent(detail[1]) };
  return { name: 'discover' };
}

export const pathFor = (route: Route): string =>
  route.name === 'discover' ? '/' : route.name === 'detail' ? `/h/${route.slug}` : `/${route.name}`;

/** Same-document navigation. `popstate` doesn't fire for pushState, so re-announce it. */
export function navigate(path: string, { replace = false } = {}) {
  if (path === location.pathname) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
  scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/**
 * Click handler for in-app links. Keeps the `href` so the link is still a real
 * link — middle-click, ⌘-click and "copy link address" all behave normally.
 */
export const linkProps = (path: string) => ({
  href: path,
  onClick: (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
  },
});
