'use strict';

let cli = require('heroku-cli-util');
let co  = require('co');
let opn = require('opn');
let fs  = require('fs');

function open (url) {
  cli.log(`Opening ${cli.color.cyan(url)}...`);
  return new Promise(function (fulfill, reject) {
    opn(url, {wait: false}, function (err) {
      if (!err) return fulfill();
      cli.error('Cannot open page.');
      cli.error(err);
      reject(new Error(`Open ${cli.color.cyan(url)} in your browser.`));
    });
  });
}

const ssoPath = '/tmp/heroku-sso.html';

function writeTemplate (ctx, sso, path) {
  return new Promise(function (fulfill, reject) {
    let html = `<!DOCTYPE HTML>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>Heroku Add-ons SSO</title>
    <script src="http://ajax.googleapis.com/ajax/libs/jquery/2.0.0/jquery.min.js"></script>
  </head>

  <body>
    <h3>Opening ${ctx.args.addon} on ${ctx.app}...</h3>
    <form method="POST" action="${sso.action}">
    </form>

    <script type="text/javascript">
      var params = ${JSON.stringify(sso.params)};
      var form = document.forms[0];
      $(document).ready(function() {
        $.each(params, function(key, value) {
          $('<input>').attr({ type: 'hidden', name: key, value: value })
            .appendTo(form);
        });
        form.submit();
      })
    </script>
  </body>
</html>`;
    fs.writeFile(path, html, function (err) {
      if (err) reject(err);
      else     fulfill();
    });
  });
}

let sudo = co.wrap(function* (ctx, api) {
  let sso = yield api.request({
    method:  'GET',
    path:    `/apps/${ctx.app}/addons/${ctx.args.addon}/sso`,
    headers: {Accept: 'application/json'},
  });
  if (sso.method === 'get') {
    yield open(sso.action);
  } else {
    yield writeTemplate(ctx, sso, ssoPath);
    yield open(`file://${ssoPath}`);
  }
});

function* run (ctx, api) {
  if (process.env.HEROKU_SUDO) return sudo(ctx, api);

  function openAddon (id) {
    return api.get(`/addons/${encodeURIComponent(id)}`)
    .then(a => open(a.web_url));
  }

  function openAppAddon (app, id) {
    if (!app || id.indexOf('::') !== -1) return openAddon(id);
    return api.get(`/apps/${app}/addons/${encodeURIComponent(id)}`)
    .catch(function (err) { if (err.statusCode === 404) return openAddon(id); else throw err; })
    .then(a => open(a.web_url));
  }

  function openAttachment(id) {
    return api.get(`/addon-attachments/${encodeURIComponent(id)}`)
    .then(a => open(a.web_url));
  }

  function openAppAttachment(app, id) {
    if (!app || id.indexOf('::') !== -1) return openAttachment(id);
    return api.get(`/apps/${ctx.app}/addon-attachments/${encodeURIComponent(id)}`)
    .then(a => open(a.web_url));
  }

  let id  = ctx.args.addon;

  try {
    yield openAppAddon(ctx.app, id);
  } catch (addonErr) {
    // if ambiguous or not found
    // check to see if it is an attachment
    if (addonErr.statusCode === 422 || addonErr.statusCode === 404) {
      try {
        yield openAppAttachment(ctx.app, id);
      } catch (attachmentErr) {
        // not found, but show the error message from the addon request instead
        if (attachmentErr.statusCode === 404) throw addonErr;
        else throw attachmentErr;
      }
    } else throw addonErr;
  }
}

module.exports = {
  topic:       'addons',
  command:     'open',
  wantsApp:    true,
  needsAuth:   true,
  args:        [{name: 'addon'}],
  run:         cli.command(co.wrap(run)),
  description: `open an add-on's dashboard in your browser`
};