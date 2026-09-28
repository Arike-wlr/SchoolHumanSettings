/* Application history is independent of WebView URL history. Entries contain
   small UI state only; records, images and document contents stay in their stores. */
(function () {
  'use strict';
  var history = [], layers = {}, key = 'view:home', generation = 0;
  var internal = 0, restoring = false, saving = false, exiting = false, opening = false;

  function resetExit() {
    if (window.Android && Android.resetBackExit) Android.resetBackExit();
  }
  function invoke(fn) {
    internal++;
    try { return fn(); } finally { internal--; }
  }
  function openLayers() {
    return Object.keys(layers).filter(function (id) {
      var layer = layers[id], el = document.getElementById(id);
      if (layer.isOpen) return layer.isOpen();
      if (!el || !el.classList.contains('active')) return false;
      var view = el.closest('.view');
      return !view || view.id === 'view-' + currentView;
    });
  }
  var scrollSelector = '.modal-body,.gs-body,.matrix-wrap,.type-tabs,.region-tabs,.cat-tabs,.main-cat-tabs';
  function scrollState(root) {
    if (!root) return [];
    return Array.prototype.map.call(root.querySelectorAll(scrollSelector), function (el) {
      return { top: el.scrollTop, left: el.scrollLeft };
    });
  }
  function applyScroll(root, states) {
    if (!root) return;
    root.querySelectorAll(scrollSelector).forEach(function (el, i) {
      if (states[i]) { el.scrollTop = states[i].top; el.scrollLeft = states[i].left; }
    });
  }
  function capture() {
    var view = currentView, module = VM[view];
    return {
      key: key, view: view, x: window.scrollX, y: window.scrollY,
      state: module && module.captureNavigation ? module.captureNavigation() : null,
      scroll: scrollState(document.getElementById('view-' + view)),
      layers: openLayers().map(function (id) {
        return { id: id, state: layers[id].capture ? layers[id].capture() : null,
          scroll: scrollState(document.getElementById(id)) };
      })
    };
  }
  function disposeExcept(keep) {
    Object.keys(layers).forEach(function (id) {
      if (keep.indexOf(id) !== -1) return;
      if (layers[id].dispose) invoke(layers[id].dispose);
      var el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
  }
  function restoreScroll(snapshot, token) {
    function apply() {
      if (token !== generation) return;
      window.scrollTo(snapshot.x, snapshot.y);
      applyScroll(document.getElementById('view-' + snapshot.view), snapshot.scroll);
      snapshot.layers.forEach(function (item) { applyScroll(document.getElementById(item.id), item.scroll); });
    }
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(function () { apply(); resolve(); }); });
    }).then(function () {
      // Late image layout must not shift the restored reading position. Stop as
      // soon as the user interacts or navigates; never fight user scrolling.
      if (!window.ResizeObserver || token !== generation) return;
      var observer = new ResizeObserver(apply);
      observer.observe(document.getElementById('view-' + snapshot.view));
      snapshot.layers.forEach(function (item) {
        var el = document.getElementById(item.id);
        if (el) observer.observe(el);
      });
      var stop = function () {
        observer.disconnect();
        ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (event) {
          document.removeEventListener(event, stop, true);
        });
      };
      ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (event) {
        document.addEventListener(event, stop, { capture: true, once: true });
      });
      setTimeout(stop, 1000);
    });
  }
  async function restorePrevious() {
    if (!history.length || restoring) return false;
    restoring = true;
    opening = false;
    var snapshot = history.pop(), token = ++generation;
    key = snapshot.key;
    resetExit();
    try {
      disposeExcept(snapshot.layers.map(function (item) { return item.id; }));
      invoke(function () { renderView(snapshot.view, false); });
      var module = VM[snapshot.view];
      if (module) {
        if (module.restoreNavigation) await invoke(function () { return module.restoreNavigation(snapshot.state); });
        else if (module.refresh) await invoke(function () { return module.refresh(); });
      }
      for (var i = 0; i < snapshot.layers.length; i++) {
        var item = snapshot.layers[i], layer = layers[item.id];
        if (layer.restore) await invoke(function () { return layer.restore(item.state); });
        else {
          var el = document.getElementById(item.id);
          if (el) el.classList.add('active');
        }
      }
      await restoreScroll(snapshot, token);
      return true;
    } catch (error) {
      // A deleted record cannot be restored. Drop that destination instead of
      // leaving a ghost history entry or a blank, uncloseable overlay.
      console.warn('[navigation] restore', error);
      showToast('原内容已不可用，返回上一位置', 'error');
      disposeExcept([]);
      key = 'view:' + currentView;
      restoring = false;
      if (history.length) return await restorePrevious();
      return false;
    } finally { restoring = false; }
  }
  function enter(nextKey, action) {
    if (internal) return action();
    if (restoring || saving || exiting || opening || nextKey === key) return Promise.resolve(false);
    history.push(capture());
    key = nextKey;
    ++generation;
    resetExit();
    var token = generation;
    opening = true;
    try {
      return Promise.resolve(invoke(action)).then(function (result) {
        if (token === generation) openLayers().forEach(function (id) {
          if (id === key) applyScroll(document.getElementById(id), [{ top: 0, left: 0 }]);
        });
        return result;
      }).catch(function (error) {
        if (token !== generation) return false;
        console.warn('[navigation] open', error);
        showToast('无法打开内容，请重试', 'error');
        return restorePrevious();
      }).finally(function () { if (token === generation) opening = false; });
    } catch (error) {
      opening = false;
      showToast('无法打开内容，请重试', 'error');
      return restorePrevious();
    }
  }
  function close(id, cleanup) {
    if (internal) { if (cleanup) return cleanup(); return; }
    if (restoring || exiting) return Promise.resolve(false);
    if (key === id && history.length) return restorePrevious();
    // An obsolete asynchronous close must not remove another destination.
    return Promise.resolve(false);
  }
  function busy() { return restoring || saving || exiting; }
  function back() {
    if (busy()) return 'busy';
    if (!history.length) return 'root';
    resetExit();
    var layer = layers[key];
    if (layer && layer.back && openLayers().indexOf(key) !== -1) layer.back();
    else restorePrevious();
    return 'handled';
  }
  async function save(operation) {
    if (busy()) return false;
    saving = true;
    resetExit();
    var controls = [];
    try {
      // Read and validate inputs synchronously, then freeze them while the
      // write is pending so later keystrokes cannot be silently discarded.
      var pending = operation();
      openLayers().forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.querySelectorAll('input,select,textarea,button').forEach(function (control) {
          controls.push({ element: control, disabled: control.disabled });
          control.disabled = true;
        });
      });
      return await pending;
    }
    catch (error) { showToast(error.message || '保存失败，请重试', 'error'); return false; }
    finally {
      controls.forEach(function (item) { item.element.disabled = item.disabled; });
      saving = false;
    }
  }
  async function prepareExit(request) {
    var ok = false;
    if (!busy() && !history.length) {
      if (typeof _syncInFlight !== 'undefined' && _syncInFlight) {
        showToast('同步正在进行，请完成后再退出');
      } else {
        exiting = true;
        window.navigationExitReady = false;
        var hint = setTimeout(function () { showToast('正在保存，请稍候…'); }, 300);
        try {
          if (typeof flushBackupForExit === 'function') await flushBackupForExit();
          ok = document.visibilityState !== 'hidden';
          window.navigationExitReady = ok;
        } catch (error) { showToast('退出前备份失败，请重试', 'error'); }
        finally { clearTimeout(hint); exiting = false; }
      }
    }
    if (window.Android && Android.finishNavigationExit) Android.finishNavigationExit(request, ok);
    return ok;
  }
  document.addEventListener('visibilitychange', function () {
    resetExit();
    if (document.visibilityState === 'visible') window.navigationExitReady = false;
  });
  document.addEventListener('pointerdown', resetExit, true);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); back(); }
    else resetExit();
  }, true);
  window.AppNavigation = {
    enter: enter, close: close, back: back, save: save, prepareExit: prepareExit,
    register: function (id, layer) { layers[id] = layer || {}; },
    token: function () { return generation; },
    isCurrent: function (token) { return token === generation; },
    isInternal: function () { return internal > 0; },
    isBusy: busy,
    suspendLayers: function () {
      openLayers().forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      document.body.classList.remove('export-mode');
    }
  };
})();
