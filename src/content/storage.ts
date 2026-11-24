export const getStorage = <T>(key: string, defaultValue: T): Promise<T> => {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (result: Record<string, T>) => {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      });
    } else {
      const val = localStorage.getItem(key);
      resolve(val ? JSON.parse(val) : defaultValue);
    }
  });
};
