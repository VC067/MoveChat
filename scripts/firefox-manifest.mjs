/** Preserve the existing AMO add-on identity and Firefox background format. */
export const createFirefoxManifest = chromeManifest => ({
  ...chromeManifest,
  name: 'MoveChat: Export & Transfer AI Chats',
  browser_specific_settings: {
    gecko: {
      id: 'movechat@vc067.github.io',
      strict_min_version: '109.0',
      data_collection_permissions: { required: ['none'] },
    },
    gecko_android: { strict_min_version: '120.0' },
  },
  background: { scripts: ['background.js'] },
});
