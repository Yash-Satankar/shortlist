/**
 * Service worker. In step 1 it only records install/update; later steps register the
 * per-site content scripts here (only for sites the user has granted) and relay API calls.
 */
chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.info(`[job-status-tracker] ${reason}`);
});
