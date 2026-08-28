var form = document.getElementById('application-form');
var company = document.getElementById('company');
var role = document.getElementById('role');
var link = document.getElementById('link');
var endpoint = document.getElementById('endpoint');
var secret = document.getElementById('secret');
var statusNode = document.getElementById('status');
var submit = document.getElementById('submit');
var settings = document.getElementById('settings');

function copyText(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(value);
  }

  var textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  var copied = document.execCommand('copy');
  textarea.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('Copy is not available.'));
}

function setStatus(message, kind) {
  statusNode.textContent = message;
  statusNode.className = 'status' + (kind ? ' ' + kind : '');
}

function validEndpoint(value) {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(value);
}

function saveDraft() {
  chrome.storage.local.set({
    applicationDraft: {
      company: company.value,
      role: role.value,
      link: link.value
    }
  });
}

chrome.storage.local.get(['endpoint', 'secret', 'applicationDraft'], function (saved) {
  endpoint.value = saved.endpoint || '';
  secret.value = saved.secret || '';
  if (!endpoint.value || !secret.value) setStatus('Open Settings and add your Web App URL and extension key.', 'error');

  var draft = saved.applicationDraft || {};
  company.value = draft.company || '';
  role.value = draft.role || '';
  link.value = draft.link || '';

  // Only take the active-tab URL for a completely new draft. A copied link
  // must survive Chrome closing the popup while the user fetches the company
  // name or role from another tab.
  if (!link.value) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var url = tabs[0] && tabs[0].url;
      if (url && /^https?:\/\//i.test(url)) {
        link.value = url;
        saveDraft();
      }
    });
  }
});

[company, role, link].forEach(function (field) {
  field.addEventListener('input', saveDraft);
  field.addEventListener('change', saveDraft);
});

document.querySelectorAll('.copy-link').forEach(function (button) {
  button.addEventListener('click', function () {
    var originalText = button.textContent;
    copyText(button.dataset.url).then(function () {
      button.textContent = 'Copied!';
      setStatus(button.dataset.url + ' copied to clipboard.', 'success');
      setTimeout(function () { button.textContent = originalText; }, 1500);
    }).catch(function () {
      setStatus('Could not copy the link. Please try again.', 'error');
    });
  });
});

document.getElementById('settings-toggle').addEventListener('click', function () {
  settings.hidden = !settings.hidden;
});

document.getElementById('save-settings').addEventListener('click', function () {
  var savedEndpoint = endpoint.value.trim();
  var savedSecret = secret.value.trim();
  if (!validEndpoint(savedEndpoint)) {
    setStatus('Use the deployed Web App URL ending in /exec.', 'error');
    return;
  }
  if (!savedSecret) {
    setStatus('The extension key is required.', 'error');
    return;
  }
  chrome.storage.local.set({ endpoint: savedEndpoint, secret: savedSecret }, function () {
    settings.hidden = true;
    setStatus('Settings saved on this browser.', 'success');
  });
});

form.addEventListener('submit', async function (event) {
  event.preventDefault();
  var target = endpoint.value.trim();
  var key = secret.value.trim();
  if (!validEndpoint(target) || !key) {
    settings.hidden = false;
    setStatus('Configure the Web App URL and extension key first.', 'error');
    return;
  }

  submit.disabled = true;
  setStatus('Adding application…');
  try {
    var response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: key,
        company: company.value.trim(),
        role: role.value.trim(),
        link: link.value.trim()
      })
    });
    var body = await response.json();
    if (!body.ok) throw new Error(body.error || 'The sheet rejected this application.');
    var message = body.result.message + (body.result.added ? ' Property #' + body.result.property + '.' : '');
    if (body.result.jobsTicked) message += ' Marked ' + body.result.jobsTicked + ' matching Jobs row(s) Applied.';
    setStatus(message, 'success');
    if (body.result.added) {
      company.value = '';
      role.value = '';
      link.value = '';
      chrome.storage.local.remove('applicationDraft');
      company.focus();
    }
  } catch (error) {
    setStatus('Could not add it: ' + error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});
