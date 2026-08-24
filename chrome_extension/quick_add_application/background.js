// A normal action popup always closes as soon as the user clicks the job page.
// Side Panel is persistent, and Chrome opens it directly from the extension icon.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function (error) {
  console.error('Could not enable the Quick Add Application side panel:', error);
});
