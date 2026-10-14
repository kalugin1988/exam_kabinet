'use strict';
(() => {
  let redirecting = false;
  let toastTimer;
  const nativeFetch = window.fetch.bind(window);
  window.Exam = {
    escape(value) {
      return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
    },
    message(element, text, kind = 'error') {
      if (!element) return;
      element.textContent = text;
      element.className = `notice notice-${kind}`;
      element.hidden = !text;
    },
    toast(text, kind = 'success') {
      const toast = document.getElementById('toast');
      if (!toast) return;
      clearTimeout(toastTimer);
      toast.textContent = text;
      toast.className = `toast ${kind}`;
      toast.hidden = false;
      toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
    },
    async request(url, options = {}) {
      try {
        const response = await nativeFetch(url, {credentials:'same-origin', ...options});
        let result;
        try { result = await response.json(); } catch { throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.'); }
        if (response.status === 401 && !String(url).startsWith('/api/auth/login')) {
          if (!redirecting) {
            redirecting = true;
            const next = window.location.pathname + window.location.search;
            const reason = result.code === 'INVALID_TOKEN' ? 'invalid' : result.code === 'AUTH_REQUIRED' ? 'required' : 'expired';
            window.location.replace(`/login?reason=${reason}&next=${encodeURIComponent(next)}`);
          }
          throw new Error(result.error || 'Войдите в систему повторно.');
        }
        if (!response.ok || result.success === false) {
          const message = result.error || result.message || (response.status === 403 ? 'Недостаточно прав для выполнения действия.' : 'Не удалось выполнить запрос.');
          const error = new Error(typeof message === 'string' ? message : 'Не удалось выполнить запрос.');
          error.status = response.status;
          throw error;
        }
        return result;
      } catch (error) {
        if (error instanceof TypeError) throw new Error('Нет связи с сервером. Проверьте подключение и повторите запрос.');
        throw error;
      }
    },
    async json(url, method, body) {
      try { return await this.request(url, {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
      catch (error) { throw error; }
    },
    async busy(button, pendingLabel, action) {
      const original = button?.textContent;
      if (button) { button.disabled = true; button.textContent = pendingLabel; }
      try { return await action(); }
      catch (error) { throw error; }
      finally { if (button) { button.disabled = false; button.textContent = original; } }
    }
  };
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    }
  }));
  document.getElementById('logoutButton')?.addEventListener('click', async event => {
    try {
      await Exam.busy(event.currentTarget, 'Выход…', () => Exam.json('/api/auth/logout','POST',{}));
      window.location.replace('/login');
    } catch (error) { Exam.toast(error.message,'error'); }
  });
})();
