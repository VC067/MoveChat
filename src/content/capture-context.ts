/** Keep page identity separate from the async scraping work. Never relabel an
 * old page's payload with the URL/title that happens to be current at the end. */
export const captureFromPage = async <T>(capture: () => Promise<T>): Promise<{
  result: T;
  sourceUrl: string;
  sourceTitle: string;
}> => {
  const sourceUrl = window.location.href;
  const sourceTitle = document.title;
  const documentRoot = document.documentElement;
  const identity = (url: string) => url.split('#')[0];
  const result = await capture();
  if (identity(window.location.href) !== identity(sourceUrl) || document.title !== sourceTitle || document.documentElement !== documentRoot) {
    throw new Error('The page changed during capture. Nothing was saved. Wait for the intended conversation to finish loading, then capture again.');
  }
  return { result, sourceUrl, sourceTitle };
};
