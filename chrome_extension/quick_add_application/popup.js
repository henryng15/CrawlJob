var form = document.getElementById('application-form');
var company = document.getElementById('company');
var role = document.getElementById('role');
var link = document.getElementById('link');
var endpoint = document.getElementById('endpoint');
var secret = document.getElementById('secret');
var statusNode = document.getElementById('status');
var submit = document.getElementById('submit');
var settings = document.getElementById('settings');
var DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyeBIf9Oud-_pZUYXkAPY3u1nCdVk1XAswgIR8M0feTszm8hQo1CtJU35GheXphBXA8JA/exec';

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

async function parseApiResponse(response) {
  var responseText = await response.text();
  var body;
  try {
    body = JSON.parse(responseText);
  } catch (parseError) {
    var contentType = response.headers.get('content-type') || '';
    var isHtml = /text\/html/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(responseText);
    var message = isHtml
      ? 'Google returned an HTML page (HTTP ' + response.status + '). Check Settings for the active Web App URL ending in /exec; it must run as you and allow anyone to access it.'
      : 'The Web App returned a non-JSON response (HTTP ' + response.status + '). Check that Settings contains the active Web App URL ending in /exec.';
    var error = new Error(message);
    error.httpStatus = response.status;
    error.isHtmlResponse = isHtml;
    throw error;
  }
  if (!body || typeof body !== 'object') throw new Error('The Web App returned an unexpected response.');
  return body;
}

async function sendApplication(target, requestBody) {
  var options = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(requestBody)
  };
  var response = await fetch(target, options);
  try {
    return { body: await parseApiResponse(response), endpointRecovered: false };
  } catch (error) {
    // A stale saved deployment returns Google's 404 HTML without reaching doPost.
    // Retry against this extension's verified deployment, then repair local Settings.
    if (!error.isHtmlResponse || error.httpStatus !== 404 || target === DEFAULT_ENDPOINT) throw error;
    var retryResponse = await fetch(DEFAULT_ENDPOINT, options);
    var retryBody = await parseApiResponse(retryResponse);
    await new Promise(function (resolve) {
      chrome.storage.local.set({ endpoint: DEFAULT_ENDPOINT }, resolve);
    });
    endpoint.value = DEFAULT_ENDPOINT;
    return { body: retryBody, endpointRecovered: true };
  }
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
  endpoint.value = saved.endpoint || DEFAULT_ENDPOINT;
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
    // data-label keeps a secret out of the status line; links show themselves.
    var shown = button.dataset.label || button.dataset.copy;
    copyText(button.dataset.copy).then(function () {
      button.textContent = 'Copied!';
      setStatus(shown + ' copied to clipboard.', 'success');
      setTimeout(function () { button.textContent = originalText; }, 1500);
    }).catch(function () {
      setStatus('Could not copy it. Please try again.', 'error');
    });
  });
});

var LOGIN = { email: 'hoanng15.work@gmail.com', password: 'Hoanhahnco123@!' };

// Runs inside the page, once per frame. Returns what it managed to fill.
function fillLoginBoxes(login) {
  var inputs = [];

  // querySelectorAll stops at a shadow boundary, so walk the roots by hand.
  // The push order is document order, which the pairing below relies on.
  function collect(root) {
    var nodes = root.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.tagName === 'INPUT') inputs.push(node);
      if (node.shadowRoot) collect(node.shadowRoot);
    }
  }
  collect(document);

  function fillable(el) {
    return !el.disabled && !el.readOnly && el.getClientRects().length > 0;
  }

  // A sign-in page rarely marks the email box as type="email", so fall back to
  // whatever the site calls it, and keep search and OTP boxes out of it.
  function looksLikeEmail(el) {
    if (el.type === 'email') return true;
    if (el.type !== 'text' && el.type !== 'tel' && el.type !== '') return false;
    var hay = [
      el.autocomplete, el.name, el.id, el.placeholder, el.getAttribute('aria-label')
    ].join(' ').toLowerCase();
    if (/search|captcha|otp|verification|zip|postal|card|company|first|last/.test(hay)) return false;
    return /e-?mail|user ?-?name|userid|user_id|login|account|identifier/.test(hay);
  }

  function precedes(a, b) {
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  // Frameworks like React listen on their own value setter, so writing
  // input.value directly leaves their state stale. Go through the prototype
  // setter and then announce the change the way a real keystroke would.
  var setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  function write(el, value) {
    el.focus();
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.blur();
  }

  var passwords = inputs.filter(function (el) { return el.type === 'password' && fillable(el); });
  var emails = inputs.filter(function (el) { return looksLikeEmail(el) && fillable(el); });

  var done = { emails: 0, passwords: 0 };
  var used = [];

  passwords.forEach(function (box) {
    // Pair each password box with the nearest email box above it, staying
    // inside the same form so a page with two forms does not cross-fill.
    var partner = emails.filter(function (el) {
      if (used.indexOf(el) !== -1) return false;
      if (box.form && el.form !== box.form) return false;
      return precedes(el, box);
    }).pop();

    if (partner) {
      write(partner, login.email);
      used.push(partner);
      done.emails += 1;
    }
    write(box, login.password);
    done.passwords += 1;
  });

  // Two-step sign-ins (Google, Microsoft) show the email box on its own first.
  if (!passwords.length && emails.length) {
    write(emails[0], login.email);
    done.emails += 1;
  }

  return done;
}

document.getElementById('login-fill').addEventListener('click', function () {
  var button = this;
  var originalText = button.textContent;

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs[0];
    if (!tab || !/^https?:\/\//i.test(tab.url || '')) {
      setStatus('Open the sign-in page first.', 'error');
      return;
    }

    button.disabled = true;
    chrome.scripting.executeScript({
      // Sign-in forms often sit in an iframe, so try every frame and add it up.
      target: { tabId: tab.id, allFrames: true },
      func: fillLoginBoxes,
      args: [LOGIN]
    }, function (results) {
      button.disabled = false;

      if (chrome.runtime.lastError) {
        setStatus('Cannot reach this page: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      var emails = 0;
      var passwords = 0;
      (results || []).forEach(function (frame) {
        if (!frame || !frame.result) return;
        emails += frame.result.emails;
        passwords += frame.result.passwords;
      });

      if (!emails && !passwords) {
        // Nothing to type into, so leave the password where it can still be pasted.
        copyText(LOGIN.password).then(function () {
          setStatus('No sign-in box found. Copied the password instead.', 'success');
        }).catch(function () {
          setStatus('No sign-in box found on this page.', 'error');
        });
        return;
      }

      var parts = [];
      if (emails) parts.push(emails + ' email');
      if (passwords) parts.push(passwords + ' password');
      button.textContent = 'Filled!';
      setStatus('Filled ' + parts.join(' and ') + ' box' + (emails + passwords > 1 ? 'es' : '') + '.', 'success');
      setTimeout(function () { button.textContent = originalText; }, 1500);
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
    var result = await sendApplication(target, {
      secret: key,
      company: company.value.trim(),
      role: role.value.trim(),
      link: link.value.trim()
    });
    var body = result.body;
    if (!body.ok) throw new Error(body.error || 'The sheet rejected this application.');
    var message = (result.endpointRecovered ? 'Updated the saved Web App URL. ' : '') + body.result.message + (body.result.added ? ' Property #' + body.result.property + '.' : '');
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
