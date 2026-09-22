(function () {
  if (window !== window.top || !window.HearthroomDownload) return;
  function download(anchor) {
    if (!anchor || !anchor.hasAttribute('download') || !anchor.href.startsWith('blob:' + location.origin + '/')) return false;
    // Start reading synchronously: callers may revoke the URL immediately after click().
    var blob = fetch(anchor.href).then(function (response) { return response.blob(); });
    blob.catch(function () {});
    window.__hrPendingBlob = { url: anchor.href, blob: blob };
    HearthroomDownload.postMessage(JSON.stringify({ url: anchor.href, name: anchor.download }));
    return true;
  }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (!download(this)) click.call(this); };
  document.addEventListener('click', function (event) {
    var anchor = event.target.closest && event.target.closest('a[download]');
    if (download(anchor)) event.preventDefault();
  }, true);
})();
