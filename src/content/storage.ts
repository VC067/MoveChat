export const getStorage = <T>(key: string, defaultValue: T): Promise<T> => {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (result: { [key: string]: any }) => {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      });
    } else {
      const val = localStorage.getItem(key);
      resolve(val ? JSON.parse(val) : defaultValue);
    }
  });
};

export const setStorage = <T>(key: string, value: T): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    } else {
      localStorage.setItem(key, JSON.stringify(value));
      resolve();
    }
  });
};
